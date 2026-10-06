import React from 'react';

export default function StudyMaterial({ content }: { content: string }) {
  return (
    <section className="mb-6">
      <h2 className="text-lg font-semibold mb-2">Study Material</h2>
      <div className="prose max-w-none bg-white p-4 rounded-md text-slate-800">
        {/* content is a markdown-like string with <!-- PAGE n --> separators; keep simple formatting */}
        {content.split('<!-- PAGE').map((part, idx) => {
          const text = part.replace(/-->/, '').trim();
          if (!text) return null;
          return (
            <article key={idx} className="mb-4">
              <pre className="whitespace-pre-wrap">{text}</pre>
            </article>
          );
        })}
      </div>
    </section>
  );
}