import React from 'react';
import LessonHeader from '@/components/lesson-header';
import LessonVideo from '@/components/lesson-video';
import StudyMaterial from '@/components/study-material';
import DoubtChat from '@/components/doubt-chat';
import fs from 'fs';
import path from 'path';

export const metadata = {
  title: 'Lesson — AI Doubt Solver',
};

export default async function LessonPage({ params }: { params: { slug: string } }) {
  const { slug } = params;

  // Attempt to load lesson and its study material content from DB. If DB/Prisma is not configured, fall back to local canonical content files.
  let lesson: any = null;
  try {
    // Dynamically import prisma to avoid startup failure if DB is not configured
    const { prisma } = await import('@/lib/prisma');
    lesson = await prisma.lesson.findUnique({ where: { slug }, include: { contents: true } });
  } catch (err) {
    // ignore — we'll fall back to local files below
    lesson = null;
  }

  let study: any = null;
  if (!lesson) {
    // Fallback: use the provided canonical study material file and a static lesson object
    const filePath = path.join(process.cwd(), 'data', 'study-material', 'human-digestive-system.md');
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      content = 'Study material is not available.';
    }
    lesson = { id: 'local-human-digestive-system', title: 'Human Digestive System', description: 'Overview of the human digestive system (fallback content).', contents: [{ sourceType: 'study-material', content }] };
    study = lesson.contents[0];
  } else {
    study = lesson.contents.find((c: any) => c.sourceType === 'study-material') || lesson.contents[0] || null;
  }

  return (
    <div className="py-8">
      <LessonHeader title={lesson.title} description={lesson.description} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <LessonVideo videoUrl={'https://www.youtube.com/embed/AUaVINUiO2I?start=23'} />
          {study ? <StudyMaterial content={study.content} /> : null}
        </div>

        <aside className="lg:col-span-1">
          <DoubtChat lessonId={lesson.id} />
        </aside>
      </div>
    </div>
  );
}
