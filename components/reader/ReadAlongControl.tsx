'use client';

import React from 'react';

/**
 * ReadAlongControl — mic toggle for hands-free read-along.
 * Feature: reader-workspace
 *
 * Requirements: 1.8, 1.9, 1.10, 10.4
 *
 * Read-along is driven exclusively by Web Speech STT (the parent wires
 * start/stop to the read-along hook). When STT is unsupported the control is
 * disabled and shows an unsupported-browser indication. After a
 * selection-triggered pause, the parent sets `active=false`; the reader simply
 * clicks again to resume — this component reflects state, it does not auto-resume.
 * All sizing uses rem/px (no `zoom`).
 */

interface ReadAlongControlProps {
  active: boolean;
  isSupported: boolean;
  onStart: () => void;
  onStop: () => void;
  /** Skip the current sentence (advance the highlight by one). */
  onSkip?: () => void;
  /** Go back one sentence (rewind the highlight by one). */
  onSkipBack?: () => void;
  /** Optional progress label, e.g. "12 / 848". */
  progressLabel?: string;
}

export function ReadAlongControl({
  active,
  isSupported,
  onStart,
  onStop,
  onSkip,
  onSkipBack,
  progressLabel,
}: ReadAlongControlProps) {
  if (!isSupported) {
    return (
      <div
        role="note"
        aria-label="Read-along unavailable"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.625rem 0.75rem',
          borderRadius: 'var(--radius, 0.5rem)',
          background: 'var(--muted, #2b0f0f)',
          border: '1px solid var(--border, #361212)',
          color: 'var(--muted-foreground, #918080)',
          fontSize: '0.8125rem',
        }}
      >
        Read-along needs Chrome (Web Speech API)
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <button
        type="button"
        aria-label={active ? 'Stop read-along' : 'Start read-along'}
        aria-pressed={active}
        onClick={active ? onStop : onStart}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          width: '100%',
          padding: '0.625rem 0.875rem',
          borderRadius: 'var(--radius, 0.5rem)',
          border: `1px solid ${active ? 'var(--primary, #c22020)' : 'var(--border, #361212)'}`,
          background: active ? 'var(--primary, #c22020)' : 'var(--muted, #2b0f0f)',
          color: active ? 'var(--primary-foreground, #fafafa)' : 'var(--foreground, #ededed)',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: 600,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
        </svg>
        <span>{active ? 'Stop Read-along' : 'Read-along'}</span>
        {progressLabel && (
          <span
            style={{
              marginLeft: 'auto',
              fontVariantNumeric: 'tabular-nums',
              opacity: 0.85,
              fontWeight: 400,
            }}
          >
            {progressLabel}
          </span>
        )}
      </button>

      {/* Move a sentence back or forward — useful for long front-matter you want
          to skip, or to re-hear a sentence. Only shown while read-along is active. */}
      {active && (onSkipBack || onSkip) && (
        <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
          {onSkipBack && (
            <button
              type="button"
              aria-label="Previous sentence"
              title="Go back one sentence"
              onClick={onSkipBack}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius, 0.5rem)',
                border: '1px solid var(--border, #361212)',
                background: 'var(--muted, #2b0f0f)',
                color: 'var(--foreground, #ededed)',
                cursor: 'pointer',
                fontSize: '0.8125rem',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 20L9 12l10-8v16z" />
                <line x1="5" y1="5" x2="5" y2="19" />
              </svg>
              <span>Back</span>
            </button>
          )}
          {onSkip && (
            <button
              type="button"
              aria-label="Skip current sentence"
              title="Skip this sentence"
              onClick={onSkip}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius, 0.5rem)',
                border: '1px solid var(--border, #361212)',
                background: 'var(--muted, #2b0f0f)',
                color: 'var(--foreground, #ededed)',
                cursor: 'pointer',
                fontSize: '0.8125rem',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 4l10 8-10 8V4z" />
                <line x1="19" y1="5" x2="19" y2="19" />
              </svg>
              <span>Skip</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
