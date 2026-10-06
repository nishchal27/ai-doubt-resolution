/* scripts/inspect-chunks.js

Inspect ContentChunk embeddings for the human-digestive-system lesson.
Prints per-chunk: id, chunkIndex/page, whether embedding is NULL, and embedding vector length (if non-null).
Does NOT print embedding values.

Usage: node scripts/inspect-chunks.js
*/

const dotenv = require('dotenv');
dotenv.config();

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set — cannot inspect DB.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const lesson = await prisma.lesson.findUnique({ where: { slug: 'human-digestive-system' } });
  if (!lesson) {
    console.error('Lesson not found: human-digestive-system');
    process.exit(1);
  }

  // Query raw to include embedding column even though Prisma treats it as Unsupported
  const rows = await prisma.$queryRaw`
    SELECT id, "chunkIndex", metadata, embedding IS NULL AS embedding_is_null
    FROM "ContentChunk"
    WHERE "lessonId" = ${lesson.id}
    ORDER BY "chunkIndex" ASC
  `;

  console.log(`Found ${rows.length} chunk(s) for lesson ${lesson.slug}`);
  for (const r of rows) {
    const page = r.metadata?.page || r.chunkIndex;
    console.log(`- id=${r.id} page=${page} embedding_is_null=${r.embedding_is_null} embedding_len=${r.embedding_len}`);
  }
}

main()
  .catch((e) => {
    console.error('Error inspecting chunks:', e?.message || e);
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });
