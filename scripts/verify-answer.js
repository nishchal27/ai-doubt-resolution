/* scripts/verify-answer.js

Verifies server-side RAG answer-generation behavior using OpenRouter and lesson-scoped retrieval.

This script performs the following for the lesson slug 'human-digestive-system':
 - Queries: several example questions (related and unrelated)
 - Retrieves relevant chunks from DB (lesson-scoped)
 - Builds a grounded prompt and calls OpenRouter chat completions
 - Prints answer and returned source metadata

Usage:
  - Ensure DATABASE_URL and OPENROUTER_API_KEY are set in your environment (.env)
  - node scripts/verify-answer.js

This script intentionally mirrors the server-side behavior implemented in src/lib/ai/answer.ts for verification.
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

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const _OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const OPENROUTER_MODEL = _OPENROUTER_MODEL.startsWith('openai/') ? _OPENROUTER_MODEL : `openai/${_OPENROUTER_MODEL}`;
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const EMBEDDING_DIM = 1536;
const DISTANCE_THRESHOLD = Number(process.env.VECTOR_DISTANCE_THRESHOLD ?? '0.3');

if (!OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY not set — cannot generate answers.');
  process.exit(1);
}

async function generateEmbedding(text) {
  const url = 'https://openrouter.ai/api/v1/embeddings';
  const body = { model: process.env.OPENROUTER_EMBED_MODEL || 'openai/text-embedding-3-small', input: text };
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

async function retrieveForLesson(lessonSlug, query, limit = 5) {
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
  return { content, raw: data };
}

async function run() {
  const lessonSlug = 'human-digestive-system';
  const queries = [
    'Where does digestion begin?',
    'What is the role of bile?',
    'What happens in the small intestine?',
    'What is photosynthesis?',
    'Explain the function of the pancreas.'
  ];

  for (const q of queries) {
    console.log('\n=== Query:', q);
    try {
      const chunks = await retrieveForLesson(lessonSlug, q, 6);
      if (!chunks.length) {
        console.log('No relevant chunks found (below threshold). Expecting unavailable response.');
        continue;
      }

      console.log(`Retrieved ${chunks.length} chunks (showing id/page/dist):`);
      for (const c of chunks) console.log(` - id=${c.id} page=${c.page} dist=${c.distance.toFixed(6)} src=${c.sourceReference}`);

      const messages = buildMessages(q, chunks, []);
      const { content, raw } = await callOpenRouter(messages);
      if (!content) {
        console.log('Model returned empty content.');
        continue;
      }
      const answer = content.trim();
      console.log('\nAnswer:');
      console.log(answer);

      // Basic checks
      if (answer === 'This information is not available in the provided learning material.') {
        console.log('[Verified] Returned unavailable message exactly.');
      } else {
        // Check that at least one source id or page is referenced in the answer (simple heuristic)
        const mentionsSource = /page|chunk|source/i.test(answer);
        console.log('[Heuristic] Mentions source-like words?', mentionsSource);
      }

    } catch (err) {
      console.error('Error processing query:', err?.message || err);
    }
  }
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });
