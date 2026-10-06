import React from 'react';

export const metadata = {
  title: 'Lesson — AI Doubt Solver',
};

export default function LessonPage({ params }: { params: { slug: string } }) {
  const { slug } = params;

  return (
    <div className="py-8">
      <h1 className="text-2xl font-bold mb-4">Lesson: {slug}</h1>

      <p className="text-slate-700 mb-4">
        This is a placeholder lesson detail page for the slug "{slug}". In later phases this page will
        show video, transcript, study material and tools to ask questions about the lesson.
      </p>

      <div className="border rounded-md p-4 bg-white text-sm text-slate-600">
        No lesson data exists yet — persistent storage and AI features will be added in later phases.
      </div>
    </div>
  );
}
