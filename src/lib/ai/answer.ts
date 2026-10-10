import { retrieveRelevantChunks, RetrievedChunk } from './retrieval';
import { config } from 'dotenv';
config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const _OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const OPENROUTER_MODEL = _OPENROUTER_MODEL.startsWith('openai/') ? _OPENROUTER_MODEL : `openai/${_OPENROUTER_MODEL}`;
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS ?? '20000');

export class AnswerError extends Error {}

export type ConversationMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export type SourceItem = {
  id: string;
  page?: number | string | null;
  sourceReference: string | null;
  excerpt: string;
  distance: number;
};

export type AnswerResult = {
  answer: string;
  sources: SourceItem[];
  raw?: any;
};

// Validate question input (reject empty/whitespace-only)
function validateQuestion(q: string) {
  if (!q || !q.toString().trim()) {
    throw new AnswerError('Question is empty or whitespace');
  }
}

// Build a grounded prompt using only retrieved chunks. The model MUST answer only using the material.
function buildMessages({
  question,
  chunks,
  history,
}: {
  question: string;
  chunks: RetrievedChunk[];
  history?: ConversationMessage[];
}) {
  // System instruction: strict grounding. Also instruct model how to resolve follow-up references using the conversation history.
  const system = `You are an assistant that answers questions using ONLY the provided learning material. Do not use any outside knowledge or make up facts. If the provided material does not contain the answer, respond exactly with: "This information is not available in the provided learning material." When you can answer, keep the response concise and cite sources from the material (include chunk/page/sourceReference where appropriate). Do not invent sources.\n\nIf the current question is a follow-up (for example it uses words like "this", "that", "it", or asks "why"/"how"), resolve those references using the provided conversation history below before using the retrieved material. Even when resolving references, you MUST still base your final answer ONLY on the provided learning material.`;

  // Collate chunks into a context block. Include id/page/sourceReference and an excerpt.
  const contextBlocks = chunks.map((c, idx) => {
    const page = c.metadata?.page ?? c.chunkIndex;
    const excerpt = (c.content || '').trim().replace(/\s+/g, ' ').slice(0, 1500);
    return `---\nChunk ${idx + 1}\nid: ${c.id}\npage: ${page}\nsourceReference: ${c.sourceReference ?? 'N/A'}\ndistance: ${c.distance}\n\n${excerpt}\n---`;
  });

  const messages: any[] = [];
  messages.push({ role: 'system', content: system });

  // Include conversation history as a single clear block (Previous conversation) so follow-up references can be resolved.
  if (history && history.length) {
    const convLines = history.map((m) => {
      const speaker = m.role === 'user' ? 'Student' : m.role === 'assistant' ? 'Assistant' : 'System';
      return `${speaker}: ${m.content}`;
    });
    messages.push({ role: 'system', content: `Previous conversation:\n${convLines.join('\n')}` });
  }

  // Provide the current user question clearly
  messages.push({ role: 'user', content: `Current question: ${question}\n\nAnswer using ONLY the provided material below. If unavailable, respond exactly: "This information is not available in the provided learning material."` });

  // Provide the retrieved material as context after the question
  messages.push({ role: 'system', content: `Retrieved material (only use this):\n\n${contextBlocks.join('\n\n')}` });

  return messages;
}

function isFollowUpQuestion(q: string) {
  if (!q) return false;
  const text = q.toLowerCase().replace(/[?!.]/g, '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return false;

  const pronouns = new Set(['that', 'this', 'it', 'they', 'them', 'those', 'these', 'there', 'here']);
  // common follow-up starters
  const followUpStarters = ['why', 'how', 'what about', 'can you', 'could you', 'explain', 'tell me', 'why is', 'why are', 'what about'];

  // If the question contains a demonstrative pronoun, consider it a follow-up
  if (words.some((w) => pronouns.has(w))) return true;

  // If short question (<=3 words) and no long identifying word, consider follow-up
  const hasLongWord = words.some((w) => w.length >= 5);
  if (words.length <= 3 && !hasLongWord) return true;

  // If starts with follow-up starter and lacks a long identifying word, treat as follow-up
  for (const s of followUpStarters) {
    if (text.startsWith(s) && !hasLongWord) return true;
  }

  return false;
}

export async function generateAnswer({
  lessonId,
  question,
  history,
  limit = 5,
}: {
  lessonId: string;
  question: string;
  history?: ConversationMessage[];
  limit?: number;
}): Promise<AnswerResult> {
  validateQuestion(question);
  if (!lessonId) throw new AnswerError('lessonId is required');

  // Determine retrieval query, incorporating recent user question if this is a short/anaphoric follow-up
  let retrievalQuery = question;
  let previousUserQuestion: string | null = null;
  let isFollowUp = false;
  try {
    isFollowUp = isFollowUpQuestion(question);
    if (isFollowUp && history && history.length) {
      // Find the most recent user message in history (search from end)
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'user' && history[i].content && history[i].content.toString().trim()) {
          previousUserQuestion = history[i].content.trim();
          retrievalQuery = `${previousUserQuestion} ${question.trim()}`;
          break;
        }
      }
    }
  } catch (e) {
    // If follow-up detection fails for any reason, fall back to the plain question
    retrievalQuery = question;
  }

  // Retrieve relevant chunks scoped to lesson using the composed retrievalQuery
  let chunks: RetrievedChunk[] = [];
  try {
    chunks = await retrieveRelevantChunks({ lessonId, query: retrievalQuery, limit });
  } catch (err: any) {
    throw new AnswerError('Retrieval error: ' + String(err?.message || err));
  }

  if (!chunks || chunks.length === 0) {
    // No relevant material for this lesson
    return { answer: 'This information is not available in the provided learning material.', sources: [] };
  }

  // Build messages for the LLM
  const messages = buildMessages({ question, chunks, history });

  if (!OPENROUTER_API_KEY) {
    throw new AnswerError('OpenRouter API key not configured (OPENROUTER_API_KEY)');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const body = {
    model: OPENROUTER_MODEL,
    messages,
    // Ask model to stream = false, temperature low to reduce hallucination
    temperature: 0.0,
    max_tokens: 800,
  } as any;

  let res: Response;
  try {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err?.name === 'AbortError') {
      throw new AnswerError('OpenRouter request timed out');
    }
    throw new AnswerError('Network error calling OpenRouter: ' + String(err?.message || err));
  }

  clearTimeout(timeout);

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    // handle rate limits specifically
    if (res.status === 429) throw new AnswerError('OpenRouter rate limit (429): ' + txt);
    throw new AnswerError(`OpenRouter API returned HTTP ${res.status}: ${txt}`);
  }

  let data: any;
  try {
    data = await res.json();

  } catch (err: any) {
    throw new AnswerError('Invalid JSON from OpenRouter: ' + String(err?.message || err));
  }

  // Parse response. OpenRouter uses choices[0].message.content similar to OpenAI
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? null;
  if (!content || typeof content !== 'string') {
    throw new AnswerError('Malformed model response: missing text content');
  }

  const answerText = content.trim();

  // If the model adhered to instruction exactly and returned the unavailable string
  if (answerText === 'This information is not available in the provided learning material.') {
    return { answer: answerText, sources: [] , raw: data };
  }

  // Build sources metadata from chunks
  const sources = chunks.map((c) => ({
    id: c.id,
    page: c.metadata?.page ?? c.chunkIndex,
    sourceReference: c.sourceReference,
    excerpt: (c.content || '').trim().replace(/\s+/g, ' ').slice(0, 600),
    distance: c.distance,
  }));

  return { answer: answerText, sources, raw: data };
}

export default { generateAnswer };
