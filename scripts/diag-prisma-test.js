// Diagnostic script: test Prisma v7 + PrismaPg connectivity and read lesson
// Do NOT print DATABASE_URL or other secrets. This script reports only basic non-sensitive info.

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
    if (lesson) {
      console.log('OK: lesson found', { id: lesson.id, slug: lesson.slug, title: lesson.title ? true : false });
    } else {
      console.log('OK: lesson not found');
    }
  } catch (err) {
    console.log('ERROR: Prisma query failed:', err?.message ?? String(err));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
