/**
 * Unit tests for the Book_Note summary section.
 * Feature: reader-workspace
 */

import { describe, it, expect } from 'vitest';
import { renderSummarySection, buildBookNotePages } from '../book-note';
import type { Annotation } from '../types';

function annotation(comment: string): Annotation {
  return {
    id: 'a', docId: 'd', startSentenceIndex: 0, endSentenceIndex: 0,
    selectedText: 'a passage', comment, aiReplies: [],
    createdAt: 't', updatedAt: 't',
  };
}

describe('renderSummarySection', () => {
  it('returns empty for no summaries', () => {
    expect(renderSummarySection([])).toBe('');
    expect(renderSummarySection([{ chapter: 0, text: '   ' }])).toBe('');
  });

  it('renders a single chapter-0 summary plainly under the heading', () => {
    const out = renderSummarySection([{ chapter: 0, text: 'the gist' }]);
    expect(out).toBe('## Summary\n\nthe gist');
    expect(out).not.toContain('### Chapter');
  });

  it('renders per-chapter sub-headings for multiple chapters', () => {
    const out = renderSummarySection([
      { chapter: 1, text: 'second' },
      { chapter: 0, text: 'first' },
    ]);
    expect(out).toContain('### Chapter 1');
    expect(out).toContain('### Chapter 2');
    // Sorted by chapter: chapter 1 (index 0) before chapter 2 (index 1).
    expect(out.indexOf('first')).toBeLessThan(out.indexOf('second'));
  });
});

describe('buildBookNotePages with summaries', () => {
  it('leads the note with the summary section', () => {
    const pages = buildBookNotePages('My Book', [annotation('a note')], [
      { chapter: 0, text: 'a running summary' },
    ]);
    expect(pages).toHaveLength(1);
    const task = pages[0].task;
    expect(task).toContain('## Summary');
    expect(task).toContain('a running summary');
    // Summary precedes the annotation passage.
    expect(task.indexOf('a running summary')).toBeLessThan(task.indexOf('a passage'));
  });

  it('produces a summary-only note when there are no annotations', () => {
    const pages = buildBookNotePages('My Book', [], [{ chapter: 0, text: 'just a summary' }]);
    expect(pages[0].task).toContain('just a summary');
  });
});
