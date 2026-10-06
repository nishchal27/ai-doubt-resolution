/* scripts/debug-retrieval-raw.js

Debug retrieval without applying a similarity threshold so we can inspect raw distances.

Usage: node scripts/debug-retrieval-raw.js
*/

const dotenv = require('dotenv');
dotenv.config();

const fetch = global.fetch || require('node-fetch');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set — cannot run debug retrieval.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || 'openai/text-embedding-3-small';
const URL = 'https://openrouter.ai/api/v1/embeddings';

if (!OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY not set — cannot generate query embedding.');
  process.exit(1);
}

async function generateEmbedding(text) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    body: JSON.stringify({ model: OPENROUTER_EMBED_MODEL, input: text }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Embedding API failed: ${res.status} ${txt}`);
  }
  const data = await res.json();
  const emb = data?.data?.[0]?.embedding;
  if (!Array.isArray(emb)) throw new Error('Unexpected embedding shape');
  return emb.map((n) => Number(n));
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
  return rows.map(r=>({id:r.id, lessonId:r.lessonId, page:r.metadata?.page || r.chunkIndex, sourceReference:r.sourceReference, distance:Number(r.distance), preview:(r.content||'').slice(0,200).replace(/\n/g,'\\n')}));
}

(async ()=>{
  const lesson = 'human-digestive-system';
  const queries = ['Where does digestion begin?', 'What is the role of bile?', 'What happens in the small intestine?', 'What is photosynthesis?'];
  for (const q of queries) {
    console.log('\n=== Query:', q);
    try {
      const res = await retrieveRaw(lesson, q, 10);
      if (!res.length) console.log('No rows returned');
      for (const r of res) {
        console.log(`- id=${r.id} page=${r.page} dist=${r.distance.toFixed(6)} src=${r.sourceReference}`);
        console.log(`  Preview: ${r.preview}`);
      }
    } catch (err) {
      console.error('Error:', err?.message || err);
    }
  }
  await prisma.$disconnect();
})();
