import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'AI Doubt Solver — Home',
  description: 'Foundation for an AI-powered lesson-specific doubt solver.',
};

export default function Home() {
  return (
    <div className="py-12">
      <h1 className="text-3xl font-extrabold mb-4">Welcome to AI Doubt Solver</h1>
      <p className="text-slate-700 mb-6">
        This is the project foundation for a lesson-specific RAG-powered educational application. Phase 1
        provides the basic app shell, routes, and tooling. AI, database and RAG functionality will be added
        in later phases.
      </p>

      <div className="space-y-3">
        <Link
          href="/lessons"
          className="inline-block rounded-md bg-slate-900 text-white px-4 py-2 text-sm hover:opacity-90"
        >
          View Lessons
        </Link>
      </div>
    </div>
  );
}
