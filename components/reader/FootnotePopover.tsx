'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * FootnotePopover — shows a footnote/endnote (or a translation, in books like
 * the long novel) inline, anchored to the clicked marker, so the reader doesn't
 * have to jump to the back of the book for every note.
 *
 * It positions itself under (or above, if there's no room) the marker element,
 * clamps within the viewport, and closes on outside-click or Escape. A "Go to
 * note ↗" action still lets the reader jump to the full note in context.
 */
interface FootnotePopoverProps {
  /** Marker element the note is anchored to (the clicked superscript link). */
  anchorEl: HTMLElement | null;
  /** The note label, e.g. "[2]". */
  label: string;
  /** The note body text. Empty/undefined when the note couldn't be resolved. */
  text: string | null;
  /** Close the popover. */
  onClose: () => void;
  /** Jump to the full note at the back of the book. */
  onGoToNote: () => void;
}

export function FootnotePopover({ anchorEl, label, text, onClose, onGoToNote }: FootnotePopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'below' | 'above' } | null>(null);

  // Position after render so we can measure the popover height.
  useLayoutEffect(() => {
    if (!anchorEl || !popRef.current) return;
    const a = anchorEl.getBoundingClientRect();
    const pop = popRef.current.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer below the marker; flip above if it would overflow the viewport.
    const spaceBelow = vh - a.bottom;
    const placement: 'below' | 'above' = spaceBelow < pop.height + margin && a.top > pop.height + margin ? 'above' : 'below';
    let top = placement === 'below' ? a.bottom + margin : a.top - pop.height - margin;

    // Center horizontally on the marker, clamped to the viewport.
    let left = a.left + a.width / 2 - pop.width / 2;
    left = Math.max(margin, Math.min(left, vw - pop.width - margin));
    top = Math.max(margin, Math.min(top, vh - pop.height - margin));

    setPos({ top, left, placement });
  }, [anchorEl, text]);

  // Close on outside click / Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node) && e.target !== anchorEl) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchorEl, onClose]);

  if (!anchorEl) return null;

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label={`Note ${label}`}
      className="footnote-popover"
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="fp-head">
        <span className="fp-label">{label}</span>
        <div className="fp-actions">
          <button type="button" className="fp-goto" onClick={onGoToNote} title="Open the full note in context">
            Go to note ↗
          </button>
          <button type="button" className="fp-close" onClick={onClose} aria-label="Close note">
            ✕
          </button>
        </div>
      </div>
      <div className="fp-body">
        {text ? text : <span className="fp-missing">Note text not found in this book.</span>}
      </div>

      <style jsx>{`
        .footnote-popover {
          z-index: 1000;
          width: min(28rem, calc(100vw - 2rem));
          max-height: 40vh;
          overflow-y: auto;
          background: var(--reader-bg, #14100f);
          color: var(--reader-text, #e5e7eb);
          border: 1px solid color-mix(in srgb, var(--reader-accent, #b83030) 45%, transparent);
          border-radius: 0.6rem;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
          font-family: var(--reader-font, Georgia, 'Times New Roman', serif);
          animation: fpIn 0.12s ease-out;
        }
        @keyframes fpIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fp-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          padding: 0.5rem 0.75rem;
          border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
          position: sticky;
          top: 0;
          background: inherit;
        }
        .fp-label {
          font-weight: 700;
          color: var(--reader-accent, #b83030);
        }
        .fp-actions {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .fp-goto {
          background: transparent;
          border: 1px solid color-mix(in srgb, var(--reader-accent, #b83030) 55%, transparent);
          color: var(--reader-accent, #b83030);
          border-radius: 0.35rem;
          padding: 0.15rem 0.5rem;
          font-size: 0.8rem;
          cursor: pointer;
          transition: background-color 0.15s ease, color 0.15s ease;
        }
        .fp-goto:hover {
          background: var(--reader-accent, #b83030);
          color: #fff;
        }
        .fp-close {
          background: transparent;
          border: none;
          color: inherit;
          opacity: 0.6;
          cursor: pointer;
          font-size: 0.9rem;
          line-height: 1;
          padding: 0.2rem;
        }
        .fp-close:hover {
          opacity: 1;
        }
        .fp-body {
          padding: 0.75rem;
          line-height: 1.6;
          font-size: 1rem;
        }
        .fp-missing {
          opacity: 0.6;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
