/* scripts/verify-service-flow.js

Simulates the real service flow: creates a conversation-like in-memory sequence and runs the retrieval+generation using the same logic (including follow-up composition as implemented in src/lib/ai/answer.ts).

This script runs cases A-E using the same OPENROUTER model and embeddings and prints answers.

Usage: node scripts/verify-service-flow.js
*/

const dotenv = require('dotenv');
dotenv.config();

const fetch = global.fetch || require('node-fetch');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set — cannot run verification.');
  process.exit(1);
}
if (!process.env.OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY not set — cannot run verification.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || 'openai/text-embedding-3-small';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const EMBEDDING_DIM = 1536;
const DISTANCE_THRESHOLD = Number(process.env.VECTOR_DISTANCE_THRESHOLD ?? '0.3');

async function generateEmbedding(text) {
  const url = 'https://openrouter.ai/api/v1/embeddings';
  const body = { model: OPENROUTER_EMBED_MODEL, input: text };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Embedding API failed: ${res.status} ${txt}`);
  }
  const data = await res.json();
  const emb = data?.data?.[0]?.embedding;
  if (!Array.isArray(emb)) throw new Error('Unexpected embedding shape');
  if (emb.length !== EMBEDDING_DIM) throw new Error(`Embedding dimension mismatch: expected ${EMBEDDING_DIM}, got ${emb.length}`);
  return emb.map((n) => Number(n));
}

async function retrieveForLesson(lessonSlug, query, limit = 6) {
  const lesson = await prisma.lesson.findUnique({ where: { slug: lessonSlug } });
  if (!lesson) throw new Error('Lesson not found: ' + lessonSlug);
  const qEmb = await generateEmbedding(query);
  const vectorString = '[' + qEmb.join(',') + ']';
  const rows = await prisma.$queryRaw`
    SELECT id, "lessonId", content, "chunkIndex", "sourceReference", metadata,
           (embedding <=> ${vectorString}::vector) AS distance
    FROM "ContentChunk"
    WHERE "lessonId" = ${lesson.id}
    ORDER BY distance ASC
    LIMIT ${limit}`;

  return rows.map((r) => ({
    id: r.id,
    page: r.metadata?.page ?? r.chunkIndex,
    content: r.content,
    sourceReference: r.sourceReference,
    distance: Number(r.distance),
  })).filter((r) => r.distance <= DISTANCE_THRESHOLD);
}

function isFollowUpQuestion(q) {
  if (!q) return false;
  const text = q.toLowerCase().replace(/[?!.]/g, '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const pronouns = new Set(['that', 'this', 'it', 'they', 'them', 'those', 'these', 'there', 'here']);
  const followUpStarters = ['why', 'how', 'what about', 'can you', 'could you', 'explain', 'tell me', 'why is', 'why are', 'what about'];
  if (words.some((w) => pronouns.has(w))) return true;
  const hasLongWord = words.some((w) => w.length >= 5);
  if (words.length <= 3 && !hasLongWord) return true;
  for (const s of followUpStarters) if (text.startsWith(s) && !hasLongWord) return true;
  return false;
}

function buildMessages(question, chunks, history = []) {
  const system = `You are an assistant that answers questions using ONLY the provided learning material. Do not use any outside knowledge or make up facts. If the provided material does not contain the answer, respond exactly with: "This information is not available in the provided learning material." When you can answer, keep the response concise and cite sources from the material (include chunk/page/sourceReference where appropriate). Do not invent sources.`;
  const contextBlocks = chunks.map((c, idx) => {
    const excerpt = (c.content || '').trim().replace(/\s+/g, ' ').slice(0, 1500);
    return `---\nChunk ${idx + 1}\nid: ${c.id}\npage: ${c.page}\nsourceReference: ${c.sourceReference ?? 'N/A'}\ndistance: ${c.distance}\n\n${excerpt}\n---`;
  });
  const messages = [];
  messages.push({ role: 'system', content: system });
  messages.push({ role: 'system', content: `Retrieved material (only use this):\n\n${contextBlocks.join('\n\n')}` });
  for (const m of history) messages.push(m);
  messages.push({ role: 'user', content: `Question: ${question}\n\nAnswer using ONLY the provided material above. If unavailable, respond exactly: "This information is not available in the provided learning material."` });
  return messages;
}

async function callOpenRouter(messages) {
  const body = { model: OPENROUTER_MODEL, messages, temperature: 0.0, max_tokens: 800 };
  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenRouter HTTP ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? null;
  return content;
}

(async ()=>{
  const lesson = 'human-digestive-system';
  const sequence = [
    { role: 'user', question: 'What is the role of bile?' },
    { role: 'user', question: 'Why is that important?' },
    { role: 'user', question: 'What is photosynthesis?' },
    { role: 'user', question: 'How does bile help?' },
    { role: 'user', question: 'What does the pancreas do?' },
  ];

  const history = []; // will hold conversation messages {role, content}

  for (let i=0;i<sequence.length;i++) {
    const q = sequence[i].question;
    // Determine retrieval query (use same heuristic as server)
    let retrievalQuery = q;
    if (isFollowUpQuestion(q) && history.length) {
      // find most recent user in history
      for (let j = history.length -1; j>=0; j--) {
        if (history[j].role === 'user') { retrievalQuery = `${history[j].content} ${q}`; break; }
      }
    }

    console.log('\n=== Q:', q);
    console.log('Retrieval query:', retrievalQuery);
    const chunks = await retrieveForLesson(lesson, retrievalQuery, 6);
    if (!chunks.length) {
      console.log('No relevant chunks found (below threshold). Expected unavailable response.');
      const messages = buildMessages(q, [], history);
      const answer = 'This information is not available in the provided learning material.';
      console.log('Answer:', answer);
      // push user and assistant messages
      history.push({ role: 'user', content: q });
      history.push({ role: 'assistant', content: answer });
      continue;
    }
    console.log('Retrieved chunks:', chunks.map(c=>`page=${c.page} dist=${c.distance.toFixed(6)}`).join('; '));

    const messages = buildMessages(q, chunks, history);
    // For debugging, show last user in history
    const lastUser = [...history].reverse().find((m)=>m.role==='user');
    console.log('Most recent prior user in history:', lastUser?.content ?? null);

    const content = await callOpenRouter(messages);
    const answer = (content || '').trim();
    console.log('Answer:', answer);

    history.push({ role: 'user', content: q });
    history.push({ role: 'assistant', content: answer });
  }

  await prisma.$disconnect();
})();
