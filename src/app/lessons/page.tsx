import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Lessons — AI Doubt Solver',
  description: 'Placeholder lesson listing for the AI Doubt Solver project foundation.',
};

export default function LessonsPage() {
  return (
    <div className="py-8">
      <h1 className="text-2xl font-bold mb-4">Lessons (Placeholder)</h1>

      <p className="text-slate-700 mb-4">
        This page will list available lessons. At this phase it is only a placeholder — there is no
        database or persistent lesson data yet. The final implementation will fetch lessons from a
        backend and allow selecting a lesson to view video, transcript and study material.
      </p>

      <div className="border rounded-md p-4 bg-white">
        <p className="mb-2 text-sm text-slate-600">
          Example placeholder link to a lesson detail route (no real data is provided):
        </p>
        <Link
          href="/lessons/human-digestive-system"
          className="text-sky-600 hover:underline"
        >
          /lessons/human-digestive-system (placeholder route)
        </Link>
      </div>
    </div>
  );
}
