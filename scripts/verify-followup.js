/* scripts/verify-followup.js

Run retrieval tests for follow-up-aware retrieval.
This script mirrors the heuristic in src/lib/ai/answer.ts and shows retrieved chunks & distances.

Usage: node scripts/verify-followup.js
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
const OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || 'openai/text-embedding-3-small';
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

async function retrieveRaw(lessonSlug, query, limit=10) {
  const lesson = await prisma.lesson.findUnique({ where: { slug: lessonSlug } });
  if (!lesson) throw new Error('Lesson not found');
  const qEmb = await generateEmbedding(query);
  const vectorString = '[' + qEmb.join(',') + ']';
  const rows = await prisma.$queryRaw`
    SELECT id, "lessonId", content, "chunkIndex", "sourceReference", metadata,
           (embedding <=> ${vectorString}::vector) AS distance
    FROM "ContentChunk"
    WHERE "lessonId" = ${lesson.id}
    ORDER BY distance ASC
    LIMIT ${limit}`;
  return rows.map(r=>({id:r.id, page:r.metadata?.page || r.chunkIndex, sourceReference:r.sourceReference, distance:Number(r.distance), preview:(r.content||'').slice(0,200).replace(/\n/g,'\\n')}));
}

(async ()=>{
  const lesson = 'human-digestive-system';

  const cases = [
    { name: 'A', history: [], question: 'What is the role of bile?' },
    { name: 'B', history: [{ role: 'user', content: 'What is the role of bile?' }], question: 'Why is that important?' },
    { name: 'C', history: [{ role: 'user', content: 'What is the role of bile?' }], question: 'What is photosynthesis?' },
    { name: 'D', history: [{ role: 'user', content: 'What is the role of bile?' }, { role: 'assistant', content: '...' }], question: 'How does bile help?' },
    { name: 'E', history: [{ role: 'user', content: 'What is the role of bile?' }, { role: 'assistant', content: '...' }, { role: 'user', content: 'How does bile help?' }], question: 'What does the pancreas do?' },
  ];

  for (const c of cases) {
    console.log('\n=== Case', c.name, c.question);
    const isFollow = isFollowUpQuestion(c.question);
    let retrievalQuery = c.question;
    if (isFollow && c.history && c.history.length) {
      // find last user
      for (let i=c.history.length-1;i>=0;i--) {
        if (c.history[i].role === 'user') {
          retrievalQuery = `${c.history[i].content} ${c.question}`;
          break;
        }
      }
    }
    console.log('Retrieval query:', retrievalQuery);
    try {
      const rows = await retrieveRaw(lesson, retrievalQuery, 6);
      if (!rows.length) console.log('No rows returned');
      for (const r of rows) console.log(`- id=${r.id} page=${r.page} dist=${r.distance.toFixed(6)} src=${r.sourceReference}`);
      const passed = rows.filter(r=>r.distance <= DISTANCE_THRESHOLD);
      console.log('Chunks passing threshold:', passed.length);
    } catch (err) {
      console.error('Error:', err?.message || err);
    }
  }

  await prisma.$disconnect();
})();
