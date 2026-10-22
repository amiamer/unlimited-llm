/**
 * @vitest-environment jsdom
 */

/**
 * Integration test for the reader-workspace annotation seam.
 * Feature: reader-workspace
 * Requirements: 1.10, 2.1, 3.1, 3.4, 3.5, 6.2
 *
 * Composes the real TextDisplay + useAnnotationWorkspace + CommentMargin the way
 * the reader page wires them (without the heavy epub/audiobook/ollama hooks), and
 * verifies: selecting text opens a popover and pauses read-along; an outside
 * click commits, rendering a thread + persistent highlight; and a Book_Note page
 * is POSTed to Obsidian.
 */

import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TextDisplay } from '../TextDisplay';
import { CommentMargin } from '../CommentMargin';
import { CommentPopover } from '../CommentPopover';
import { useAnnotationWorkspace } from '@/lib/reader-workspace/use-annotation-workspace';
import type { Chapter } from '@/lib/types/reader';

function installLocalStorageMock(): void {
  const backing = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
      clear: () => backing.clear(),
      key: (i: number) => Array.from(backing.keys())[i] ?? null,
      get length() {
        return backing.size;
      },
    },
  });
}

const chapter: Chapter = {
  index: 0,
  title: 'Ch',
  href: '',
  sentences: ['Alpha sentence.', 'Beta sentence.'],
  paragraphs: [{ sentences: ['Alpha sentence.', 'Beta sentence.'] }],
};

function Harness({ onPause }: { onPause: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const ws = useAnnotationWorkspace({
    docId: 'doc-1',
    docTitle: 'Test Book',
    sentenceCount: 2,
    sentences: chapter.sentences,
    onSelectionPauseReadAlong: onPause,
  });

  return (
    <div ref={scrollRef}>
      <TextDisplay
        chapters={[chapter]}
        currentChapter={0}
        currentSentenceIndex={-1}
        annotations={ws.annotations}
        activeThreadId={ws.activeThreadId}
        onSelection={ws.beginSelection}
      />
      {ws.pendingPopover && (
        <CommentPopover
          pending={ws.pendingPopover}
          onChangeText={ws.setPendingText}
          onCommit={ws.commitPending}
          onToggleLink={() => ws.setPendingLink(!ws.pendingPopover!.linkEnabled)}
          onChangeLinkTarget={ws.setPendingLinkTarget}
        />
      )}
      {ws.annotations.length > 0 && (
        <CommentMargin
          annotations={ws.annotations}
          activeThreadId={ws.activeThreadId}
          aiStatus={ws.aiStatus}
          syncStatus={ws.syncStatus}
          scrollContainerRef={scrollRef}
          onSelectThread={ws.setActiveThread}
          onRequestAi={ws.requestAiReply}
          onEdit={ws.editAnnotation}
          onEditSelectedText={ws.editSelectedText}
          onDelete={ws.deleteAnnotation}
          onRetrySync={ws.retrySync}
        />
      )}
    </div>
  );
}

describe('reader-workspace integration', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('select → popover (pauses read-along) → outside click commits → thread + Obsidian POST', async () => {
    const posted: Array<{ task: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        // The workspace also talks to /api/annotations (server file store);
        // this test asserts on the Obsidian note posts only.
        if (String(url).includes('/api/obsidian/note') && init?.body) {
          posted.push(JSON.parse(init.body as string));
        }
        return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
      }),
    );
    const onPause = vi.fn();

    const { container } = render(<Harness onPause={onPause} />);

    // Select the first sentence span.
    const span = container.querySelector('[data-sentence-index="0"]')!;
    const range = document.createRange();
    range.selectNodeContents(span);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.mouseUp(container.querySelector('.text-display-container')!);

    // Popover opened and read-along was paused (Req 1.10/2.1).
    const field = await screen.findByRole('textbox', { name: 'Comment text' });
    expect(onPause).toHaveBeenCalled();

    // Type a comment, then click truly outside to commit (Req 3.1).
    fireEvent.change(field, { target: { value: 'my annotation' } });
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);

    // A comment thread renders (Req 3.4) ...
    await waitFor(() =>
      expect(screen.getByText('my annotation')).toBeInTheDocument(),
    );
    // ... a persistent highlight is applied to the anchored sentence (Req 3.5).
    // Note highlights come from the reader theme's note color, not a
    // hard-coded one.
    const highlighted = container.querySelector('[data-sentence-index="0"]') as HTMLElement;
    expect(highlighted.style.backgroundColor).toContain('--reader-hl-note');
    // ... and a Book_Note page was POSTed to Obsidian (Req 6.2).
    await waitFor(() => expect(posted.length).toBeGreaterThanOrEqual(1));
    expect(posted[0].task.split('\n')[0]).toBe('reading/annotations/Test Book');
  });
});
