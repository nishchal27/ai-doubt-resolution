/* scripts/embed-content.js

Idempotent embedding ingestion for Phase 4.
Finds ContentChunk rows with NULL embedding (except transcripts) and sets embedding using OpenRouter.

Usage:
  - Ensure DATABASE_URL and OPENROUTER_API_KEY are set in environment (or .env)
  - node scripts/embed-content.js
*/

const dotenv = require('dotenv');
dotenv.config();

const fetch = global.fetch || require('node-fetch');
const { PrismaClient } = require('@prisma/client');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set — cannot run embedding ingestion.');
  process.exit(1);
}

const { PrismaPg } = require('@prisma/adapter-pg');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const _OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || 'openai/text-embedding-3-small';
const OPENROUTER_EMBED_MODEL = _OPENROUTER_EMBED_MODEL.startsWith('openai/') ? _OPENROUTER_EMBED_MODEL : `openai/${_OPENROUTER_EMBED_MODEL}`;
const EMBEDDING_DIM = 1536; // must match DB vector(1536)

if (!OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY not set — embeddings cannot be generated.');
  process.exit(1);
}

async function generateEmbedding(text) {
  if (!text || !text.toString().trim()) throw new Error('Empty input text');

  const url = 'https://openrouter.ai/api/v1/embeddings';
  const body = { model: OPENROUTER_EMBED_MODEL, input: text };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Embedding API failed: ${res.status} ${txt}`);
  }

  const data = await res.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error('Unexpected embedding shape');
  if (embedding.length !== EMBEDDING_DIM) throw new Error(`Embedding dimension mismatch: expected ${EMBEDDING_DIM}, got ${embedding.length}`);
  return embedding.map((n) => Number(n));
}

async function main() {
  console.log('Looking for ContentChunks with NULL embedding...');
  const lesson = await prisma.lesson.findUnique({ where: { slug: 'human-digestive-system' } });
  if (!lesson) {
    console.error('Lesson "human-digestive-system" not found');
    process.exit(1);
  }

  // Find chunks that actually have NULL embedding using a raw query (Prisma may not surface the Unsupported column)
  const toEmbed = await prisma.$queryRaw`
    SELECT id, content, "chunkIndex", metadata, "sourceType"
    FROM "ContentChunk"
    WHERE "lessonId" = ${lesson.id}
      AND embedding IS NULL
      AND "sourceType" != 'transcript'
    ORDER BY "chunkIndex" ASC
  `;

  if (!toEmbed.length) {
    console.log('Found 0 chunk(s) needing embeddings (excluding transcripts)');
    return;
  }
  console.log(`Found ${toEmbed.length} chunk(s) needing embeddings (excluding transcripts)`);

  for (const c of toEmbed) {
    try {
      const page = c.metadata?.page || c.chunkIndex;
      console.log(`Embedding chunk id=${c.id} page=${page}...`);
      const emb = await generateEmbedding(c.content);
      const vectorString = '[' + emb.join(',') + ']';
      await prisma.$executeRaw`
        UPDATE "ContentChunk" SET embedding = ${vectorString}::vector WHERE id = ${c.id}
      `;
      console.log(`Embedded chunk ${c.id} (len=${emb.length})`);
    } catch (err) {
      console.error('Failed to embed chunk', c.id, err?.message || err);
      process.exit(1);
    }
  }

  console.log('Embedding ingestion complete.');
}

main()
  .catch((e) => {
    console.error('Error during embedding ingestion:', e);
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });
