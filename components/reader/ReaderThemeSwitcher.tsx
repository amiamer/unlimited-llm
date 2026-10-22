'use client';

import React from 'react';
import { READER_THEMES } from '@/lib/reader-sources/reader-themes';

/**
 * ReaderThemeSwitcher — a row of color swatches to recolor the reading surface
 * live. Sits at the top of the reading column; red stays the accent throughout.
 */
export function ReaderThemeSwitcher({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="reader-theme-switcher" role="radiogroup" aria-label="Reading background">
      {READER_THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={selected === t.id}
          aria-label={t.label}
          title={t.label}
          onClick={() => onSelect(t.id)}
          className={`swatch ${selected === t.id ? 'active' : ''} ${t.light ? 'light' : ''}`}
          style={{ background: t.swatch }}
        />
      ))}
      <style jsx>{`
        .reader-theme-switcher {
          display: flex;
          gap: 0.4rem;
          align-items: center;
          padding: 0.35rem 0.5rem;
          background: rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(6px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 9999px;
        }
        .swatch {
          width: 1.15rem;
          height: 1.15rem;
          border-radius: 9999px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          cursor: pointer;
          padding: 0;
          transition: transform 0.12s ease, box-shadow 0.12s ease;
        }
        .swatch.light {
          border-color: rgba(0, 0, 0, 0.25);
        }
        .swatch:hover {
          transform: scale(1.12);
        }
        .swatch.active {
          box-shadow: 0 0 0 2px var(--reader-accent, #c5402f);
          transform: scale(1.12);
        }
      `}</style>
    </div>
  );
}
