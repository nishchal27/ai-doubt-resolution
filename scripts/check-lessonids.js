/* scripts/check-lessonids.js

Print lessonId for all ContentChunks belonging to human-digestive-system and verify they match the lesson id.
*/

const dotenv = require('dotenv');
dotenv.config();

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set — cannot run check.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

(async ()=>{
  const lesson = await prisma.lesson.findUnique({ where: { slug: 'human-digestive-system' } });
  if (!lesson) {
    console.error('Lesson not found');
    process.exit(1);
  }
  const rows = await prisma.$queryRaw`
    SELECT id, "lessonId", "chunkIndex", "sourceReference", embedding IS NULL AS embedding_is_null
    FROM "ContentChunk"
    WHERE "lessonId" = ${lesson.id}
    ORDER BY "chunkIndex" ASC
  `;
  console.log('Lesson id:', lesson.id);
  for (const r of rows) {
    console.log(`- chunk id=${r.id} chunkIndex=${r.chunkIndex} lessonId=${r.lessonId} sourceRef=${r.sourceReference} embedding_is_null=${r.embedding_is_null}`);
  }
  await prisma.$disconnect();
})();
