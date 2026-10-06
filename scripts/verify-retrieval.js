/* scripts/verify-retrieval.js

Simple verification script that demonstrates lesson-scoped retrieval.
Runs several example queries against the human-digestive-system lesson and prints results.

Usage:
  - Ensure DATABASE_URL and OPENROUTER_API_KEY are set
  - node scripts/verify-retrieval.js
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
const _OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || 'openai/text-embedding-3-small';
const OPENROUTER_EMBED_MODEL = _OPENROUTER_EMBED_MODEL.startsWith('openai/') ? _OPENROUTER_EMBED_MODEL : `openai/${_OPENROUTER_EMBED_MODEL}`;
const EMBEDDING_DIM = 1536;
const DISTANCE_THRESHOLD = Number(process.env.VECTOR_DISTANCE_THRESHOLD ?? '0.3');

if (!OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY not set — embeddings cannot be generated.');
  process.exit(1);
}

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
    page: r.metadata?.page || r.chunkIndex,
    contentPreview: (r.content || '').slice(0, 200).replace(/\n/g, '\\n'),
    sourceReference: r.sourceReference,
    distance: Number(r.distance),
  })).filter((r) => r.distance <= DISTANCE_THRESHOLD);
}

async function main() {
  const lessonSlug = 'human-digestive-system';
  const queries = [
    'Where does digestion begin?',
    'What is the role of bile?',
    'What happens in the small intestine?',
    'What is photosynthesis? (unrelated)'
  ];

  for (const q of queries) {
    console.log('\n=== Query:', q);
    try {
      const res = await retrieveForLesson(lessonSlug, q, 5);
      if (!res.length) {
        console.log('No relevant chunks found (below threshold).');
      } else {
        for (const r of res) {
          console.log(`- Page: ${r.page} id=${r.id} dist=${r.distance.toFixed(6)} src=${r.sourceReference}`);
          console.log(`  Preview: ${r.contentPreview}`);
        }
      }
    } catch (err) {
      console.error('Error retrieving for query:', err?.message || err);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });
