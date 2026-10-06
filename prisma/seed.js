const { PrismaClient } = require('@prisma/client');

// Prisma v7 requires a driver adapter when connecting to a database.
// If DATABASE_URL is not provided in the environment, we skip connecting and exit gracefully.
let prisma;
if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL not set — skipping DB seed. To seed, set DATABASE_URL to your Supabase connection string.');
} else {
  // Lazily require the adapter to avoid errors when no DB is configured.
  const { PrismaPg } = require('@prisma/adapter-pg');
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  prisma = new PrismaClient({ adapter });
}

async function main() {
  if (!prisma) {
    console.log('No DATABASE_URL provided — seed skipped.');
    return;
  }

  const lesson = await prisma.lesson.upsert({
    where: { slug: 'human-digestive-system' },
    update: {},
    create: {
      slug: 'human-digestive-system',
      title: 'Human Digestive System',
      description: 'Placeholder lesson for the human digestive system',
    },
  });

    // Ensure the two lesson content records exist, but don't create duplicates when seeding multiple times.
  const contents = [
    {
      sourceType: 'transcript',
      title: 'Transcript (placeholder)',
      content: 'This is placeholder transcript content for the Human Digestive System lesson.',
    },
    {
      sourceType: 'study-material',
      title: 'Study Guide (placeholder)',
      content: 'This is placeholder study material for the Human Digestive System lesson.',
    },
  ];

  for (const item of contents) {
    const existing = await prisma.lessonContent.findFirst({
      where: { lessonId: lesson.id, sourceType: item.sourceType },
    });
    if (!existing) {
      await prisma.lessonContent.create({
        data: {
          lessonId: lesson.id,
          sourceType: item.sourceType,
          title: item.title,
          content: item.content,
        },
      });
    }
  }


  console.log('Seed completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });
