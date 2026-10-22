'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  checkpointSummary,
  loadSummary,
  loadSummaryDurable,
  saveSummary,
} from '@/lib/reader-workspace/summary-store';

/**
 * ReaderSummaryStrip — a "slide notes"-style strip pinned under the reading
 * panel. Drag the handle up to expand, drag down to collapse. Click the bar
 * to toggle. Persists per document + chapter and syncs after a short pause.
 */

interface ReaderSummaryStripProps {
  docId: string;
  chapter: number;
  label?: string;
  /** Return false when either Obsidian target failed to update. */
  onCommit?: () => void | boolean | Promise<void | boolean>;
}

type SaveState = 'idle' | 'local' | 'syncing' | 'synced' | 'error';

const MIN_HEIGHT = 0;
const DEFAULT_HEIGHT = 160;
const MAX_HEIGHT_VH = 0.5; // 50% of viewport
const AUTOSYNC_DELAY_MS = 900;

export function ReaderSummaryStrip({ docId, chapter, label, onCommit }: ReaderSummaryStripProps) {
  const [height, setHeight] = useState(MIN_HEIGHT); // 0 = collapsed
  const [text, setText] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const latestText = useRef('');
  const localSaved = useRef(true);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const documentGeneration = useRef(0);
  const editVersion = useRef(0);
  const mounted = useRef(true);

  const clearCommitTimer = useCallback(() => {
    if (commitTimer.current) {
      clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
  }, []);

  const commit = useCallback((): Promise<boolean> => {
    clearCommitTimer();
    const value = latestText.current;
    const generation = documentGeneration.current;
    const version = editVersion.current;
    const localOk = localSaved.current;

    const run = async (): Promise<boolean> => {
      if (mounted.current && documentGeneration.current === generation) {
        setSaveState('syncing');
      }

      // Preserve this pause as history before updating either vault note. The
      // current IDB value remains owned by per-keystroke saveSummary writes.
      const durableOk = await checkpointSummary(docId, chapter, value);
      let syncOk = true;
      try {
        const result = await onCommit?.();
        syncOk = result !== false;
      } catch (error) {
        console.error('[reader-summary] Obsidian sync failed:', error);
        syncOk = false;
      }

      const storageOk = localOk || durableOk;
      if (
        mounted.current &&
        documentGeneration.current === generation &&
        editVersion.current === version
      ) {
        setSaveState(storageOk && syncOk ? 'synced' : 'error');
      }
      return storageOk && syncOk;
    };

    // Blur, collapse, debounce, and pagehide all share this queue. If another
    // edit arrives during a request, its commit runs afterward and wins last.
    const next = commitQueue.current.then(run, run);
    commitQueue.current = next;
    return next;
  }, [chapter, clearCommitTimer, docId, onCommit]);

  const scheduleCommit = useCallback(() => {
    clearCommitTimer();
    commitTimer.current = setTimeout(() => void commit(), AUTOSYNC_DELAY_MS);
  }, [clearCommitTimer, commit]);

  useEffect(() => {
    let cancelled = false;
    documentGeneration.current += 1;
    editVersion.current += 1;
    localSaved.current = true;
    const local = loadSummary(docId, chapter);
    latestText.current = local;
    setText(local);
    setSaveState(local ? 'local' : 'idle');

    // Restore from IndexedDB if the synchronous copy was lost. Never overwrite
    // text entered while this asynchronous recovery read was in flight.
    void loadSummaryDurable(docId, chapter).then((durable) => {
      if (cancelled || latestText.current !== local || durable === local) return;
      latestText.current = durable;
      editVersion.current += 1;
      localSaved.current = true; // loadSummaryDurable materialized it locally.
      setText(durable);
      setSaveState('local');
      // Auto-heal both vault notes after recovering a newer durable copy.
      scheduleCommit();
    });

    return () => {
      cancelled = true;
      clearCommitTimer();
    };
    // scheduleCommit deliberately omitted: this load must run only when the
    // document key changes, not whenever a parent callback gets a new identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, chapter]);

  useEffect(() => {
    mounted.current = true;
    const flush = () => {
      // Each keystroke is already local; the shared queue prevents this flush
      // from racing a debounce/blur commit and landing an older vault write last.
      void commit();
    };
    const flushIfHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushIfHidden);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushIfHidden);
    };
  }, [commit]);

  const onChange = (value: string) => {
    setText(value);
    latestText.current = value;
    editVersion.current += 1;
    localSaved.current = saveSummary(docId, chapter, value);
    setSaveState(localSaved.current ? 'local' : 'error');
    scheduleCommit();
  };

  const isOpen = height > 0;

  const toggle = () => {
    if (isOpen) {
      void commit();
      setHeight(MIN_HEIGHT);
    } else {
      setHeight(DEFAULT_HEIGHT);
    }
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag from the handle bar itself, not the button text
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = height;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [height]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const maxHeight = window.innerHeight * MAX_HEIGHT_VH;
    // Dragging UP = increasing height (pointer moves up = negative delta)
    const delta = startY.current - e.clientY;
    const newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, startHeight.current + delta));
    setHeight(newHeight);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    // Snap closed if dragged below a threshold
    if (height < 40) {
      setHeight(MIN_HEIGHT);
      void commit();
    }
  }, [height, commit]);

  const hasContent = text.trim().length > 0;
  const preview = hasContent ? text.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  const statusText = saveState === 'local' ? 'saved locally'
    : saveState === 'syncing' ? 'syncing…'
    : saveState === 'synced' ? 'saved + synced'
    : saveState === 'error' ? 'saved locally · sync failed'
    : '';

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: '1px solid var(--reader-muted, #2a2a2a)',
        background: 'var(--reader-bg, #1a0505)',
      }}
    >
      {/* Drag handle + click toggle bar */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={(e) => {
          // Only toggle on click if it wasn't a drag
          if (Math.abs(startY.current - e.clientY) < 5 || !startY.current) {
            toggle();
          }
        }}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.45rem 1rem',
          background: 'transparent',
          border: 'none',
          cursor: 'ns-resize',
          color: 'var(--reader-muted, #b9b3af)',
          fontSize: '0.82rem',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          textAlign: 'left',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        {/* Drag indicator */}
        <span style={{ fontSize: '0.6rem', opacity: 0.5, letterSpacing: '2px' }}>⋯</span>
        <span style={{ fontWeight: 600, color: 'var(--reader-heading, #d7d3d0)' }}>Summary</span>
        {label && <span style={{ opacity: 0.65 }}>· {label}</span>}
        {hasContent && !isOpen && (
          <span
            style={{
              marginLeft: '0.5rem',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              opacity: 0.5,
              fontSize: '0.78rem',
            }}
          >
            {preview}
          </span>
        )}
        {hasContent && isOpen && statusText && (
          <span
            title={saveState === 'error' ? 'Your browser copy remains available; Obsidian needs another sync attempt.' : statusText}
            style={{
              marginLeft: 'auto',
              opacity: saveState === 'error' ? 0.95 : 0.62,
              color: saveState === 'error' ? '#f2a08f' : 'var(--reader-muted, #b9b3af)',
              fontSize: '0.72rem',
            }}
          >
            {statusText}
          </span>
        )}
      </div>

      {/* Expandable textarea area */}
      {isOpen && (
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => void commit()}
          placeholder="Write your running summary here…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'none', // we handle resize via drag
            height: `${height}px`,
            background: 'var(--reader-bg, #140404)',
            color: 'var(--reader-text, #d7d3d0)',
            border: 'none',
            borderTop: '1px solid var(--reader-muted, #2a2a2a)',
            padding: '0.75rem 1rem',
            fontSize: '0.95rem',
            lineHeight: 1.6,
            outline: 'none',
            fontFamily: 'var(--reader-font, Georgia, serif)',
            caretColor: '#e86e4e',
            overflow: 'auto',
          }}
        />
      )}
    </div>
  );
}
