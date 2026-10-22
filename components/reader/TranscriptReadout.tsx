'use client';

import React from 'react';

/**
 * TranscriptReadout — shows what the speech recognizer is currently hearing.
 * Feature: reader-workspace (Req 11)
 *
 * A small, unobtrusive readout of the live Web Speech interim transcript, so
 * the reader can diagnose mismatches between their voice and the highlight.
 * Renders nothing while read-along is inactive; shows a quiet placeholder when
 * active but nothing has been heard yet (never an error). rem/px sizing, no zoom.
 */

interface TranscriptReadoutProps {
  active: boolean;
  transcript: string;
}

export function TranscriptReadout({ active, transcript }: TranscriptReadoutProps) {
  if (!active) return null;

  const hasText = transcript.trim().length > 0;

  return (
    <div
      aria-label="Live transcript"
      style={{
        marginTop: '0.5rem',
        padding: '0.625rem 0.75rem',
        borderRadius: 'var(--radius, 0.5rem)',
        background: 'var(--muted, #2b0f0f)',
        border: '1px solid var(--border, #361212)',
        fontSize: '0.75rem',
        lineHeight: 1.5,
        color: hasText ? 'var(--foreground, #ededed)' : 'var(--muted-foreground, #918080)',
        maxHeight: '5rem',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          fontSize: '0.625rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--muted-foreground, #918080)',
          marginBottom: '0.25rem',
        }}
      >
        Hearing
      </div>
      <div style={{ fontStyle: hasText ? 'normal' : 'italic' }}>
        {hasText ? transcript : 'Listening…'}
      </div>
    </div>
  );
}
