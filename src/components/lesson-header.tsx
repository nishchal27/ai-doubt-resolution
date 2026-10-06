import React from 'react';

export default function LessonHeader({ title, description }: { title: string; description?: string | null }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      {description ? <p className="text-slate-700 mt-2">{description}</p> : null}
    </header>
  );
}