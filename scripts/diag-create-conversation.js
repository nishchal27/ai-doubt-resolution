// Diagnostic script: create a conversation for the human-digestive-system lesson
// Reports only non-sensitive information (conversation id or error)

const path = require('path');
// Load environment variables from repo root .env so this script behaves like the app
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('SKIP: DATABASE_URL not set in environment');
    process.exit(0);
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const lesson = await prisma.lesson.findUnique({ where: { slug: 'human-digestive-system' } });
    if (!lesson) {
      console.log('ERROR: lesson with slug human-digestive-system not found');
      process.exit(1);
    }

    const conv = await prisma.conversation.create({ data: { lessonId: lesson.id } });
    console.log('OK: conversation created', { id: conv.id });
  } catch (err) {
    console.log('ERROR: failed to create conversation:', err?.message ?? String(err));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
