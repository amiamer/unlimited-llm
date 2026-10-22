'use client';

interface ErrorDisplayProps {
  error: string | null;
}

export default function ErrorDisplay({ error }: ErrorDisplayProps) {
  if (!error) {
    return null;
  }

  return (
    <div className="p-3 bg-red-900 border border-red-700 rounded-lg text-red-200">
      <p className="text-sm">{error}</p>
    </div>
  );
}