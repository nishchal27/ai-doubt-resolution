"use client";

import React from 'react';

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);

  return (
    <div className="py-12">
      <h1 className="text-3xl font-extrabold mb-4">Something went wrong</h1>
      <p className="text-slate-700 mb-6">An unexpected error occurred. Please try again.</p>
      <button
        onClick={() => reset()}
        className="inline-block rounded-md bg-slate-900 text-white px-4 py-2 text-sm hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
