/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for TextDisplay read-along + annotation rendering.
 * Feature: reader-workspace
 * Requirements: 1.3, 1.4, 3.5, 4.3, 8.5
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TextDisplay } from '../TextDisplay';
import type { Chapter } from '@/lib/types/reader';
import type { Annotation } from '@/lib/reader-workspace/types';

afterEach(() => cleanup());

const chapter: Chapter = {
  index: 0,
  title: 'Chapter One',
  href: '',
  sentences: ['Sentence zero.', 'Sentence one.', 'Sentence two.'],
  paragraphs: [
    { sentences: ['Sentence zero.', 'Sentence one.', 'Sentence two.'] },
  ],
};

function bg(el: Element | null): string {
  return (el as HTMLElement)?.style.backgroundColor ?? '';
}

describe('TextDisplay — read-along + annotation highlighting', () => {
  it('highlights the read-along pointer sentence and trails read_aloud sentences', () => {
    const { container } = render(
      <TextDisplay
        chapters={[chapter]}
        currentChapter={0}
        currentSentenceIndex={-1}
        readAlongActive
        readAlongPointer={1}
        readAlongStates={['read_aloud', 'read_aloud', 'unread']}
      />,
    );

    const s0 = container.querySelector('[data-sentence-index="0"]');
    const s1 = container.querySelector('[data-sentence-index="1"]');
    const s2 = container.querySelector('[data-sentence-index="2"]');

    // Pointer (s1) gets the accent-derived current highlight (theme-aware).
    expect(bg(s1)).toContain('--reader-accent');
    // Already-read s0 gets the neutral currentColor trail (jsdom lowercases it).
    expect(bg(s0)).toContain('currentcolor');
    // Unread s2 has no read-along background.
    expect(bg(s2)).toBe('');
  });

  it('marks the clicked sentence when read-along is off, keeping a note highlight under it', () => {
    Element.prototype.scrollIntoView = vi.fn(); // auto-scroll to the position; jsdom lacks it
    const annotations: Annotation[] = [
      { id: 'n', docId: 'doc', startSentenceIndex: 2, endSentenceIndex: 2, selectedText: 'x', comment: 'note', aiReplies: [], createdAt: 't', updatedAt: 't' },
    ];
    const { container, rerender } = render(
      <TextDisplay chapters={[chapter]} currentChapter={0} currentSentenceIndex={1} annotations={annotations} />,
    );
    const s1 = container.querySelector('[data-sentence-index="1"]') as HTMLElement;
    expect(s1.style.boxShadow).toContain('--reader-accent');
    expect(bg(s1)).toContain('--reader-accent');
    expect((container.querySelector('[data-sentence-index="0"]') as HTMLElement).style.boxShadow).toBe('');

    rerender(<TextDisplay chapters={[chapter]} currentChapter={0} currentSentenceIndex={2} annotations={annotations} />);
    const s2 = container.querySelector('[data-sentence-index="2"]') as HTMLElement;
    expect(s2.style.boxShadow).toContain('--reader-accent');
    expect(bg(s2)).toContain('--reader-hl-note,');
  });

  it('applies persistent annotation highlight to the anchored range; active is emphasized', () => {
    const annotations: Annotation[] = [
      {
        id: 'a',
        docId: 'doc',
        startSentenceIndex: 0,
        endSentenceIndex: 1,
        selectedText: 'x',
        comment: 'note',
        aiReplies: [],
        createdAt: 't',
        updatedAt: 't',
      },
    ];

    const { container, rerender } = render(
      <TextDisplay
        chapters={[chapter]}
        currentChapter={0}
        currentSentenceIndex={-1}
        annotations={annotations}
        activeThreadId={null}
      />,
    );

    // Inactive annotation → the theme's note highlight on indices 0 and 1.
    expect(bg(container.querySelector('[data-sentence-index="0"]'))).toContain('--reader-hl-note,');
    expect(bg(container.querySelector('[data-sentence-index="1"]'))).toContain('--reader-hl-note,');
    expect(bg(container.querySelector('[data-sentence-index="2"]'))).toBe('');

    const inactiveAlpha = bg(container.querySelector('[data-sentence-index="0"]'));

    // Active annotation → stronger emphasis.
    rerender(
      <TextDisplay
        chapters={[chapter]}
        currentChapter={0}
        currentSentenceIndex={-1}
        annotations={annotations}
        activeThreadId="a"
      />,
    );
    const activeAlpha = bg(container.querySelector('[data-sentence-index="0"]'));
    expect(activeAlpha).not.toBe(inactiveAlpha);
    expect(activeAlpha).toContain('--reader-hl-note-active');
  });

  it('paints link annotations with the link highlight, and a note wins where both cover a sentence', () => {
    const base = { docId: 'doc', selectedText: 'x', comment: '', aiReplies: [], createdAt: 't', updatedAt: 't' };
    const annotations: Annotation[] = [
      { ...base, id: 'link', startSentenceIndex: 0, endSentenceIndex: 1, linkTarget: 'Logic' },
      { ...base, id: 'note', startSentenceIndex: 1, endSentenceIndex: 1, comment: 'note' },
    ];
    const { container } = render(
      <TextDisplay chapters={[chapter]} currentChapter={0} currentSentenceIndex={-1} annotations={annotations} activeThreadId={null} />,
    );
    expect(bg(container.querySelector('[data-sentence-index="0"]'))).toContain('--reader-hl-link,');
    expect(bg(container.querySelector('[data-sentence-index="1"]'))).toContain('--reader-hl-note,');
  });

  it('reports a non-empty selection through onSelection', () => {
    const onSelection = vi.fn();
    const { container } = render(
      <TextDisplay
        chapters={[chapter]}
        currentChapter={0}
        currentSentenceIndex={-1}
        onSelection={onSelection}
      />,
    );

    // Simulate a real selection over the first sentence span.
    const span = container.querySelector('[data-sentence-index="0"]')!;
    const range = document.createRange();
    range.selectNodeContents(span);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const root = container.querySelector('.text-display-container')!;
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(onSelection).toHaveBeenCalledTimes(1);
  });

  it('jumps to a clicked sentence via onSentenceClick (no active selection)', () => {
    const onSentenceClick = vi.fn();
    const { container } = render(
      <TextDisplay
        chapters={[chapter]}
        currentChapter={0}
        currentSentenceIndex={-1}
        onSentenceClick={onSentenceClick}
      />,
    );
    window.getSelection()?.removeAllRanges();
    const span = container.querySelector('[data-sentence-index="2"]') as HTMLElement;
    span.click();
    expect(onSentenceClick).toHaveBeenCalledWith(2);
  });

  it('renders the current sentence word-by-word when word states are available (Req 12)', () => {
    const { container } = render(
      <TextDisplay
        chapters={[chapter]}
        currentChapter={0}
        currentSentenceIndex={-1}
        readAlongActive
        readAlongPointer={1}
        readAlongStates={['unread', 'unread', 'unread']}
        inSentencePos={1}
        currentSentenceTokens={['sentence', 'one']}
      />,
    );
    const sentenceSpan = container.querySelector('[data-sentence-index="1"]')!;
    const wordSpans = sentenceSpan.querySelectorAll('span');
    expect(wordSpans.length).toBeGreaterThanOrEqual(2);
    expect((wordSpans[0] as HTMLElement).style.backgroundColor).toContain('currentcolor');
    expect((wordSpans[1] as HTMLElement).style.backgroundColor).toContain('--reader-accent');
  });

  it('falls back to whole-sentence highlight when word states are unavailable (Req 12.4)', () => {
    const { container } = render(
      <TextDisplay
        chapters={[chapter]}
        currentChapter={0}
        currentSentenceIndex={-1}
        readAlongActive
        readAlongPointer={1}
        readAlongStates={['unread', 'unread', 'unread']}
        inSentencePos={-1}
        currentSentenceTokens={[]}
      />,
    );
    const sentenceSpan = container.querySelector('[data-sentence-index="1"]') as HTMLElement;
    expect(sentenceSpan.querySelectorAll('span').length).toBe(0);
    expect(sentenceSpan.style.backgroundColor).toContain('--reader-accent');
  });
});
