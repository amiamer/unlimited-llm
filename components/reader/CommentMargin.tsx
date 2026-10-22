'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  Annotation,
  AiState,
  SyncState,
} from '@/lib/reader-workspace/types';
import { layoutThreads, type ThreadLayoutInput } from '@/lib/reader-workspace/margin-layout';
import { CommentThread } from './CommentThread';

function isLinkOnly(a: Annotation): boolean {
  return a.linkTarget !== undefined;
}

function LinkChip({
  annotation,
  active,
  onSelect,
  onDelete,
}: {
  annotation: Annotation;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const label = annotation.linkTarget?.trim() || annotation.selectedText?.trim() || '?';
  return (
    <div
      role="group"
      aria-label="Link annotation"
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.3rem 0.6rem',
        borderRadius: '4px',
        border: `1px solid ${active ? 'rgba(200,60,60,0.55)' : 'rgba(200,60,60,0.25)'}`,
        background: active ? 'rgba(200,60,60,0.14)' : 'rgba(200,60,60,0.06)',
        cursor: 'pointer',
        fontSize: '0.8rem',
        color: active ? 'rgba(240,190,190,0.95)' : 'rgba(210,160,160,0.8)',
        userSelect: 'none',
      }}
    >
      <span style={{ fontFamily: 'monospace', flexGrow: 1 }}>{`[[${label}]]`}</span>
      <button
        aria-label="Delete link annotation"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'rgba(200,100,100,0.7)',
          fontSize: '0.75rem',
          padding: '0 2px',
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}

/**
 * CommentMargin — the right-margin column of anchored comment threads.
 * Feature: reader-workspace
 *
 * Requirements: 4.1, 4.2, 4.4, 10.2
 *
 * Each thread is positioned to vertically align with its anchored passage,
 * measured via `getBoundingClientRect` relative to the scroll container.
 * Overlapping threads are pushed down by the pure `layoutThreads` helper.
 * Positions recompute on scroll, resize, and annotation changes.
 *
 * Note (per spec risk call-out): the measure→layout→reposition loop is the
 * jank-prone part. Measurement is read in a layout effect and applied in a
 * single state update; scroll/resize are throttled via rAF.
 */

interface CommentMarginProps {
  annotations: Annotation[];
  activeThreadId: string | null;
  aiStatus: Record<string, AiState>;
  syncStatus: Record<string, SyncState>;
  /** The scrolling container that holds the text column (for offset measurement). */
  scrollContainerRef: React.RefObject<HTMLElement>;
  onSelectThread: (id: string | null) => void;
  onRequestAi: (id: string, followUp?: string) => void;
  onEdit: (id: string, comment: string) => void;
  onEditSelectedText: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onRetrySync: (id: string) => void;
}

/** Find the top offset of an annotation's first sentence within the container. */
function measureDesiredTop(
  container: HTMLElement,
  annotation: Annotation,
): number | null {
  const el = container.querySelector<HTMLElement>(
    `[data-sentence-index="${annotation.startSentenceIndex}"]`,
  );
  if (!el) return null;
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  // Offset of the passage top relative to the container's scrolled content.
  return eRect.top - cRect.top + container.scrollTop;
}

export function CommentMargin({
  annotations,
  activeThreadId,
  aiStatus,
  syncStatus,
  scrollContainerRef,
  onSelectThread,
  onRequestAi,
  onEdit,
  onEditSelectedText,
  onDelete,
  onRetrySync,
}: CommentMarginProps) {
  const [tops, setTops] = useState<Record<string, number>>({});
  const threadRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const rafRef = useRef<number | null>(null);

  // When a thread becomes active (e.g. the reader clicked its highlighted
  // passage), scroll it into view so "click the quote → see the comment" works.
  useEffect(() => {
    if (!activeThreadId) return;
    const node = threadRefs.current.get(activeThreadId);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeThreadId]);

  const recompute = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Build layout inputs in document order (ascending start index).
    const ordered = [...annotations].sort(
      (a, b) => a.startSentenceIndex - b.startSentenceIndex,
    );

    const inputs: ThreadLayoutInput[] = [];
    for (const a of ordered) {
      const desiredTop = measureDesiredTop(container, a);
      if (desiredTop === null) continue; // passage not currently rendered
      const node = threadRefs.current.get(a.id);
      const height = node?.offsetHeight ?? 80;
      inputs.push({ id: a.id, desiredTop, height });
    }

    const laid = layoutThreads(inputs);
    const next: Record<string, number> = {};
    for (const r of laid) next[r.id] = r.top;
    setTops(next);
  }, [annotations, scrollContainerRef]);

  // Throttle recompute to animation frames for smooth scroll/resize handling.
  const scheduleRecompute = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      recompute();
    });
  }, [recompute]);

  // Recompute after layout whenever annotations change.
  useLayoutEffect(() => {
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations]);

  // Recompute on scroll + resize.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', scheduleRecompute, { passive: true });
    window.addEventListener('resize', scheduleRecompute);

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(scheduleRecompute)
        : null;
    if (ro) ro.observe(container);

    return () => {
      container.removeEventListener('scroll', scheduleRecompute);
      window.removeEventListener('resize', scheduleRecompute);
      if (ro) ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [scrollContainerRef, scheduleRecompute]);

  return (
    <div
      aria-label="Comments"
      style={{
        position: 'relative',
        width: '20rem',
        flexShrink: 0,
        // The margin shares the container's scroll; threads are absolutely
        // positioned within this relative track.
      }}
    >
      {annotations.map((a) => (
        <div
          key={a.id}
          ref={(node) => {
            if (node) threadRefs.current.set(a.id, node);
            else threadRefs.current.delete(a.id);
          }}
          style={{
            position: 'absolute',
            top: `${tops[a.id] ?? 0}px`,
            left: 0,
            right: 0,
            transition: 'top 0.12s ease-out',
            // Hidden until first measured to avoid a flash at top:0.
            visibility: tops[a.id] === undefined ? 'hidden' : 'visible',
            paddingLeft: '0.75rem',
          }}
        >
          {isLinkOnly(a) ? (
            <LinkChip
              annotation={a}
              active={activeThreadId === a.id}
              onSelect={() => onSelectThread(a.id)}
              onDelete={() => onDelete(a.id)}
            />
          ) : (
            <CommentThread
              annotation={a}
              active={activeThreadId === a.id}
              aiState={aiStatus[a.id] ?? 'idle'}
              syncState={syncStatus[a.id] ?? 'idle'}
              onSelect={() => onSelectThread(a.id)}
              onRequestAi={(followUp) => onRequestAi(a.id, followUp)}
              onEdit={(comment) => onEdit(a.id, comment)}
              onEditSelectedText={(text) => onEditSelectedText(a.id, text)}
              onDelete={() => onDelete(a.id)}
              onRetrySync={() => onRetrySync(a.id)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
