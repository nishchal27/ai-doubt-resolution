/* scripts/preview-chunks.js

Outputs a concise preview for each ContentChunk belonging to the human-digestive-system lesson.
Prints:
- page number (chunkIndex / metadata.page)
- chunk ID
- extracted character count
- beginning of content (first ~120 chars)
- end of content (last ~120 chars)

Requires DATABASE_URL in environment (.env).
*/

const dotenv = require('dotenv');
dotenv.config();

const { PrismaClient } = require('@prisma/client');
let prisma;
if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL not set — cannot preview DB content.');
  process.exit(0);
} else {
  const { PrismaPg } = require('@prisma/adapter-pg');
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  prisma = new PrismaClient({ adapter });
}

async function main() {
  const lesson = await prisma.lesson.findUnique({ where: { slug: 'human-digestive-system' } });
  if (!lesson) {
    console.log('Lesson not found');
    return;
  }

  const chunks = await prisma.contentChunk.findMany({ where: { lessonId: lesson.id }, orderBy: { chunkIndex: 'asc' } });
  if (!chunks.length) {
    console.log('No ContentChunk records found for lesson.');
    return;
  }

  for (const c of chunks) {
    const page = c.metadata && c.metadata.page ? c.metadata.page : c.chunkIndex;
    const text = c.content || '';
    const charCount = text.length;
    const first = text.slice(0, 120);
    const last = text.slice(Math.max(0, charCount - 120));

    console.log('---');
    console.log(`Page: ${page}`);
    console.log(`Chunk ID: ${c.id}`);
    console.log(`Char count: ${charCount}`);
    console.log(`Beginning:\n${first.replace(/\n/g, '\\n')}\n`);
    console.log(`End:\n${last.replace(/\n/g, '\\n')}\n`);
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
