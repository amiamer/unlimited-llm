'use client';

import React, { useState, useEffect, useRef } from 'react';
import { READER_FONTS } from '@/lib/reader-sources/reader-fonts';

/**
 * ReaderFontPicker — a collapsible floating pill for picking the reading font.
 * Shows an "Aa" button; expands to a row of labeled font options on click.
 * Collapses when clicking outside or pressing Escape.
 */
export function ReaderFontPicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div ref={rootRef} className="rfp-root">
      <button
        type="button"
        className={`rfp-toggle ${open ? 'active' : ''}`}
        aria-label="Font picker"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Change font"
      >
        Aa
      </button>

      {open && (
        <div className="rfp-panel" role="radiogroup" aria-label="Reading font">
          {READER_FONTS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={selected === f.id}
              className={`rfp-option ${selected === f.id ? 'active' : ''}`}
              style={{ fontFamily: f.stack }}
              onClick={() => { onSelect(f.id); setOpen(false); }}
              title={f.stack}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <style jsx>{`
        .rfp-root {
          position: relative;
          display: flex;
          align-items: center;
        }
        .rfp-toggle {
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: rgba(255, 255, 255, 0.7);
          background: rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(6px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 9999px;
          padding: 0.3rem 0.6rem;
          cursor: pointer;
          transition: color 0.12s ease, background 0.12s ease;
          line-height: 1;
        }
        .rfp-toggle:hover,
        .rfp-toggle.active {
          color: rgba(255, 255, 255, 0.95);
          background: rgba(0, 0, 0, 0.55);
        }
        .rfp-panel {
          position: absolute;
          top: calc(100% + 0.4rem);
          right: 0;
          display: flex;
          gap: 0.25rem;
          padding: 0.35rem 0.5rem;
          background: rgba(14, 12, 10, 0.88);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.5rem;
          z-index: 100;
          white-space: nowrap;
        }
        .rfp-option {
          font-size: 0.8rem;
          padding: 0.3rem 0.55rem;
          border-radius: 0.3rem;
          border: 1px solid transparent;
          color: rgba(255, 255, 255, 0.65);
          background: transparent;
          cursor: pointer;
          transition: color 0.1s, background 0.1s, border-color 0.1s;
        }
        .rfp-option:hover {
          color: rgba(255, 255, 255, 0.9);
          background: rgba(255, 255, 255, 0.07);
        }
        .rfp-option.active {
          color: #fff;
          border-color: var(--reader-accent, #c5402f);
          background: rgba(197, 64, 47, 0.12);
        }
      `}</style>
    </div>
  );
}
