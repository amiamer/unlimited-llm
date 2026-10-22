'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PendingPopover } from '@/lib/reader-workspace/types';

const POPOVER_WIDTH = 352; // 22rem

function clampLeft(left: number): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
  return Math.max(8, Math.min(left, vw - POPOVER_WIDTH - 8));
}

/**
 * CommentPopover — transient comment-entry surface shown at a selection.
 * Feature: reader-workspace
 *
 * Two modes:
 *  - Comment-only: text area + optional AI send
 *  - Link mode (toggle via the chain button): text area (optional note) +
 *    a small "link target" input. On commit the annotation stores `linkTarget`
 *    so the selection is saved as both an Obsidian [[wikilink]] in the article
 *    body AND (if comment is non-empty) as an annotation in the comment file.
 *
 * Commit happens ONLY on a true outside mousedown, never inside the popover.
 */

interface CommentPopoverProps {
  pending: PendingPopover;
  onChangeText: (text: string) => void;
  onCommit: () => void;
  onSendToAi?: () => void;
  onToggleLink: () => void;
  onChangeLinkTarget: (target: string) => void;
}

// Chain-link SVG icon
function LinkIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export function CommentPopover({
  pending,
  onChangeText,
  onCommit,
  onSendToAi,
  onToggleLink,
  onChangeLinkTarget,
}: CommentPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // Keep the popover fully on-screen: prefer below the selection, flip above
  // when there isn't room (e.g. selecting near the bottom of the viewport),
  // and clamp as a last resort so it's never rendered off-screen.
  const [pos, setPos] = useState<{ top: number; left: number }>(() => ({
    top: pending.rect.top + pending.rect.height + 10,
    left: clampLeft(pending.rect.left),
  }));

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vh = window.innerHeight;
    const margin = 8;
    const below = pending.rect.top + pending.rect.height + 10;
    let top: number;
    if (below + h <= vh - margin) {
      top = below;                          // fits below the selection
    } else {
      const above = pending.rect.top - h - 10;
      top = above >= margin ? above : Math.max(margin, vh - h - margin);
    }
    setPos({ top, left: clampLeft(pending.rect.left) });
  }, [pending.rect.top, pending.rect.left, pending.rect.height, pending.linkEnabled, pending.alreadyHighlighted, pending.alreadyLinked]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && root.contains(e.target)) return;
      onCommit();
    };
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => document.removeEventListener('mousedown', handleMouseDown, true);
  }, [onCommit]);

  const handleCopy = () => {
    const text = pending.anchor.selectedText ?? '';
    if (!text) return;
    try {
      void navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable */ }
  };

  const linkActive = pending.linkEnabled;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Add comment"
      style={{
        position: 'fixed',
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        zIndex: 1050,
        width: '22rem',
        background: '#1c1c22',
        border: `1px solid ${linkActive ? 'rgba(194,48,48,0.45)' : 'rgba(255,255,255,0.13)'}`,
        borderRadius: '0.5rem',
        padding: '0.75rem',
        boxShadow: '0 12px 40px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.3)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      {/* Hint when the selection overlaps an existing highlight */}
      {pending.alreadyHighlighted && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.3rem 0.5rem',
            background: 'rgba(232,110,78,0.12)',
            border: '1px solid rgba(232,110,78,0.3)',
            borderRadius: '0.3rem',
            color: 'rgba(232,140,110,0.95)',
            fontSize: '0.74rem',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          This text is already highlighted
        </div>
      )}

      {/* Hint when this term is already linked elsewhere in the article */}
      {pending.alreadyLinked && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.3rem 0.5rem',
            background: 'rgba(140,40,180,0.12)',
            border: '1px solid rgba(140,40,180,0.3)',
            borderRadius: '0.3rem',
            color: 'rgba(180,120,220,0.95)',
            fontSize: '0.74rem',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          Already linked elsewhere in this article
        </div>
      )}

      {/* Main comment textarea */}
      <textarea
        aria-label="Comment text"
        value={pending.text}
        onChange={(e) => onChangeText(e.target.value)}
        placeholder={linkActive ? 'Note (optional)…' : 'Add a comment… (middle-click to dictate)'}
        rows={3}
        autoFocus
        style={{
          resize: 'none',
          background: '#26262e',
          color: '#f0ede8',
          border: '1px solid rgba(255,255,255,0.13)',
          borderRadius: '0.375rem',
          padding: '0.5rem 0.625rem',
          fontSize: '0.9rem',
          lineHeight: 1.5,
          outline: 'none',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          caretColor: '#e86e4e',
        }}
        onFocus={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.28)'; }}
        onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.13)'; }}
      />

      {/* Link target input — only shown when link mode is on */}
      {linkActive && (
        <input
          type="text"
          aria-label="Wikilink target"
          value={pending.linkTarget}
          onChange={(e) => onChangeLinkTarget(e.target.value)}
          placeholder="[[link target]] — blank = selected text"
          style={{
            background: '#26262e',
            color: '#e86e4e',
            border: '1px solid rgba(194,48,48,0.35)',
            borderRadius: '0.375rem',
            padding: '0.375rem 0.625rem',
            fontSize: '0.82rem',
            outline: 'none',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            caretColor: '#e86e4e',
          }}
          onFocus={(e) => { e.target.style.borderColor = 'rgba(194,48,48,0.65)'; }}
          onBlur={(e) => { e.target.style.borderColor = 'rgba(194,48,48,0.35)'; }}
        />
      )}

      {/* Button row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        {/* Link toggle */}
        <button
          type="button"
          aria-label={linkActive ? 'Remove wikilink' : 'Save as wikilink'}
          title={linkActive ? 'Remove wikilink' : 'Save as [[wikilink]]'}
          onClick={onToggleLink}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.3rem 0.55rem',
            background: linkActive ? 'rgba(194,48,48,0.18)' : 'transparent',
            color: linkActive ? 'rgba(232,110,78,0.95)' : 'rgba(160,155,150,0.7)',
            border: `1px solid ${linkActive ? 'rgba(194,48,48,0.4)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: '0.3rem',
            cursor: 'pointer',
            fontSize: '0.78rem',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            transition: 'all 0.12s',
          }}
          onMouseEnter={(e) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = linkActive ? 'rgba(194,48,48,0.28)' : 'rgba(255,255,255,0.06)';
          }}
          onMouseLeave={(e) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = linkActive ? 'rgba(194,48,48,0.18)' : 'transparent';
          }}
        >
          <LinkIcon />
          {linkActive ? '[[linked]]' : 'link'}
        </button>

        {/* Copy selected text — grab the quote without leaving a comment */}
        <button
          type="button"
          aria-label="Copy selected text"
          title="Copy selected text"
          onClick={handleCopy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
            padding: '0.3rem 0.55rem',
            background: copied ? 'rgba(74,222,128,0.16)' : 'transparent',
            color: copied ? 'rgba(134,239,172,0.95)' : 'rgba(160,155,150,0.7)',
            border: `1px solid ${copied ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: '0.3rem',
            cursor: 'pointer',
            fontSize: '0.78rem',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            transition: 'all 0.12s',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          {copied ? 'copied' : 'copy'}
        </button>
        </div>

        {/* AI send button */}
        {onSendToAi && (
          <button
            type="button"
            aria-label="Send comment to AI"
            title="Send to AI"
            onClick={() => onSendToAi()}
            style={{
              width: '2.1rem',
              height: '2.1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(194,48,48,0.85)',
              color: '#fafafa',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(194,48,48,1)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(194,48,48,0.85)'; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4L12 3z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
