import React from 'react';

export default function LessonVideo({ videoUrl }: { videoUrl: string }) {
  // Simple responsive iframe wrapper
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2">Lesson Video</h2>
      <div className="w-full aspect-video bg-black rounded-md overflow-hidden">
        <iframe
          title="Lesson video"
          src={videoUrl}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full h-full"
        />
      </div>
    </div>
  );
}