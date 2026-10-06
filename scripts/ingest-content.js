/* scripts/ingest-content.js

Idempotent ingestion script for Phase 3 — ingest NCERT Chapter 6 (Human Digestive System)

This updated script uses a deterministic, page-aware canonical markdown source
(data/study-material/human-digestive-system.md) instead of parsing the PDF.

Usage:
  - Ensure DATABASE_URL is set in your environment (or in a .env file at project root).
  - npm run ingest (script provided) or: node scripts/ingest-content.js

Behavior:
  - Reads data/study-material/human-digestive-system.md which contains exactly 4 pages marked with <!-- PAGE n -->
  - Parses the four page sections and creates/updates a study-material LessonContent
  - Deletes any existing ContentChunk records for that LessonContent and recreates exactly one ContentChunk per page
  - Leaves embeddings NULL (embeddings belong to Phase 4)
  - Does NOT create or fabricate transcript content

This script is safe to run multiple times (idempotent).
*/

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load .env if present
dotenv.config();

const { PrismaClient } = require('@prisma/client');

// Prisma adapter is used lazily only when DATABASE_URL exists (same pattern as prisma/seed.js)
let prisma;
if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL not set — skipping DB ingestion. To ingest, set DATABASE_URL to your Postgres connection string.');
  process.exit(0);
} else {
  const { PrismaPg } = require('@prisma/adapter-pg');
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  prisma = new PrismaClient({ adapter });
}

function parseStudyMaterialPages(mdText) {
  // Matches: <!-- PAGE n --> followed by content until the next marker or EOF
  const pageRegex = /<!--\s*PAGE\s*(\d+)\s*-->([\s\S]*?)(?=<!--\s*PAGE\s*\d+\s*-->|$)/g;
  const pages = [];
  for (const m of mdText.matchAll(pageRegex)) {
    const num = parseInt(m[1], 10);
    const content = (m[2] || '').trim();
    pages.push({ pageNumber: num, content });
  }
  // Ensure pages are sorted by pageNumber
  pages.sort((a, b) => a.pageNumber - b.pageNumber);
  return pages.map((p) => p.content);
}

async function main() {
  const mdPath = path.join(process.cwd(), 'data', 'study-material', 'human-digestive-system.md');
  if (!fs.existsSync(mdPath)) {
    console.error('Study material markdown file not found at', mdPath);
    process.exit(1);
  }

  const md = fs.readFileSync(mdPath, 'utf-8');
  const pages = parseStudyMaterialPages(md);

  if (pages.length !== 4) {
    console.warn(`Expected exactly 4 pages in the canonical study material; found ${pages.length}. Proceeding with what was parsed.`);
  }

  console.log(`Parsed ${pages.length} page(s) from canonical study material.`);

  // Upsert lesson
  const lesson = await prisma.lesson.upsert({
    where: { slug: 'human-digestive-system' },
    update: {
      title: 'Human Digestive System',
    },
    create: {
      slug: 'human-digestive-system',
      title: 'Human Digestive System',
      description: 'NCERT Class 10 Science — Chapter 6: Human Digestive System',
    },
  });

  // Upsert lesson content (study-material) using the markdown as canonical source
  const sourceUrl = 'data/study-material/human-digestive-system.md';
  const title = 'NCERT Class 10 Science — Chapter 6: Human Digestive System';
  const fullText = pages.map((p, idx) => `<!-- PAGE ${idx + 1} -->\n${p}`).join('\n\n');

  // Find existing study-material LessonContent records for this lesson
  const studyContents = await prisma.lessonContent.findMany({ where: { lessonId: lesson.id, sourceType: 'study-material' } });
  let lessonContent;
  if (studyContents.length === 0) {
    lessonContent = await prisma.lessonContent.create({
      data: {
        lessonId: lesson.id,
        sourceType: 'study-material',
        title,
        content: fullText,
        sourceUrl,
        metadata: { pages: pages.length },
      },
    });
    console.log('Created LessonContent (study-material) id=' + lessonContent.id);
  } else {
    // Prefer an existing record that already points to this sourceUrl, otherwise update the first one and remove duplicates
    let candidate = studyContents.find((c) => c.sourceUrl === sourceUrl) || studyContents[0];
    lessonContent = await prisma.lessonContent.update({
      where: { id: candidate.id },
      data: {
        content: fullText,
        title,
        sourceUrl,
        metadata: { pages: pages.length },
      },
    });
    console.log('Updated existing LessonContent (study-material) id=' + lessonContent.id);

    // Delete any other study-material records to avoid duplicates
    const others = studyContents.filter((c) => c.id !== lessonContent.id).map((c) => c.id);
    if (others.length) {
      const del = await prisma.lessonContent.deleteMany({ where: { id: { in: others } } });
      console.log(`Deleted ${del.count} duplicate study-material LessonContent record(s).`);
    }
  }

  // Delete existing chunks for this lessonContent to avoid duplicates, then recreate exactly one chunk per page
  const deleted = await prisma.contentChunk.deleteMany({ where: { lessonContentId: lessonContent.id } });
  if (deleted.count) {
    console.log(`Deleted ${deleted.count} existing ContentChunk(s) for lessonContentId=${lessonContent.id}`);
  }

  const chunksData = pages.map((pg, idx) => {
    const pageNumber = idx + 1;
    const text = (pg || '').trim();
    return {
      lessonContentId: lessonContent.id,
      content: text,
      chunkIndex: pageNumber,
      sourceType: 'study-material',
      sourceReference: `${sourceUrl}#page=${pageNumber}`,
      metadata: { page: pageNumber },
    };
  });

  // Insert chunks via parameterized raw queries. We already deleted existing chunks for this lessonContent,
  // so a straight INSERT is idempotent for repeated runs of this script.
  for (const c of chunksData) {
    const id = 'ingest_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now() + '_' + c.chunkIndex;
    const sourceRef = c.sourceReference;
    const pageNum = c.chunkIndex;
    const meta = c.metadata || {};
    await prisma.$executeRaw`
      INSERT INTO "ContentChunk" (id, "lessonId", "lessonContentId", content, "chunkIndex", "sourceType", "sourceReference", metadata)
      VALUES (${id}, ${lesson.id}, ${c.lessonContentId}, ${c.content}, ${pageNum}, ${c.sourceType}, ${sourceRef}, ${JSON.stringify(meta)})
    `;
  }

  console.log(`Created ${pages.length} ContentChunk(s) for lesson "${lesson.slug}".`);

  // Transcript: check for a local transcript file but do NOT fabricate one
  const transcriptPathTxt = path.join(process.cwd(), 'data', 'ncert-chapter6-transcript.txt');
  const transcriptPathJson = path.join(process.cwd(), 'data', 'ncert-chapter6-transcript.json');
  if (fs.existsSync(transcriptPathTxt) || fs.existsSync(transcriptPathJson)) {
    const transcriptContent = fs.existsSync(transcriptPathTxt)
      ? fs.readFileSync(transcriptPathTxt, 'utf-8')
      : fs.readFileSync(transcriptPathJson, 'utf-8');

    // Upsert transcript LessonContent
    let transcriptRecord = await prisma.lessonContent.findFirst({
      where: { lessonId: lesson.id, sourceType: 'transcript' },
    });
    if (!transcriptRecord) {
      transcriptRecord = await prisma.lessonContent.create({
        data: {
          lessonId: lesson.id,
          sourceType: 'transcript',
          title: 'Transcript (provided)',
          content: transcriptContent,
          sourceUrl: fs.existsSync(transcriptPathTxt) ? 'data/ncert-chapter6-transcript.txt' : 'data/ncert-chapter6-transcript.json',
        },
      });
      console.log('Created transcript LessonContent id=' + transcriptRecord.id);
    } else {
      await prisma.lessonContent.update({ where: { id: transcriptRecord.id }, data: { content: transcriptContent } });
      console.log('Updated existing transcript LessonContent id=' + transcriptRecord.id);
    }
  } else {
    console.log('No local transcript file found. Transcript ingestion skipped (no fabrication).');
  }

  console.log('Ingestion complete.');
}

main()
  .catch((e) => {
    console.error('Error during ingestion:', e);
    process.exit(1);
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });
