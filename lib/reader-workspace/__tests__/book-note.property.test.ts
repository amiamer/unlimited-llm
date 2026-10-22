/**
 * Property-Based Tests for Book_Note pagination/serialization.
 * Feature: reader-workspace
 *
 * Property 5: Every Book_Note page respects the per-page limit and header format
 * Property 6: Pagination drops no annotation content (completeness)
 * Property 7: Regeneration after delete reflows and truly removes content
 * Property 8: Per-page Book_Note titles are stable across updates
 * Property 9: Rendered block contains its passage, comment, and replies
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  buildBookNotePages,
  bookNotePageTitle,
  renderAnnotationBlock,
  BOOK_NOTE_BANNER,
  OBSIDIAN_TASK_LIMIT,
} from '../book-note';
import type { Annotation } from '../types';

/**
 * Annotation arbitrary whose comment is a unique token, so substring presence/
 * absence checks are collision-free for the completeness/delete properties.
 */
function annotationArb(opts?: { commentLen?: fc.Arbitrary<string> }): fc.Arbitrary<Annotation> {
  const comment = opts?.commentLen ?? fc.uuid();
  return fc.record({
    id: fc.uuid(),
    docId: fc.constant('doc'),
    startSentenceIndex: fc.nat({ max: 1000 }),
    endSentenceIndex: fc.nat({ max: 1000 }),
    selectedText: fc.string({ maxLength: 40 }).map((s) => s.replace(/\n/g, ' ')),
    comment,
    aiReplies: fc.array(
      fc.record({ id: fc.uuid(), content: fc.uuid(), createdAt: fc.constant('t') }),
      { maxLength: 3 },
    ),
    createdAt: fc.constant('t'),
    updatedAt: fc.constant('t'),
  });
}

/** Recover the body portion of a page task (everything after the banner). */
function bodyOf(task: string): string {
  const idx = task.indexOf(BOOK_NOTE_BANNER);
  if (idx < 0) return task;
  return task.slice(idx + BOOK_NOTE_BANNER.length);
}

describe('book-note — property tests', () => {
  // Feature: reader-workspace, Property 5: Every Book_Note page respects the per-page limit and header format
  it('Property 5: each page <= 5000 chars with correct title line + banner line', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 60 }),
        fc.array(annotationArb(), { maxLength: 120 }),
        (docTitle, annotations) => {
          const pages = buildBookNotePages(docTitle, annotations);
          expect(pages.length).toBeGreaterThanOrEqual(1);

          pages.forEach((page, i) => {
            expect(page.task.length).toBeLessThanOrEqual(OBSIDIAN_TASK_LIMIT);
            const lines = page.task.split('\n');
            // Line 1 is the deterministic page title.
            expect(lines[0]).toBe(bookNotePageTitle(docTitle, i + 1));
            // Line 2 is blank (so parseNoteTask treats only line 1 as title).
            expect(lines[1]).toBe('');
            // Line 3 is the do-not-hand-edit banner.
            expect(lines[2]).toBe(BOOK_NOTE_BANNER);
          });
        },
      ),
      { numRuns: 150 },
    );
  });

  // Feature: reader-workspace, Property 5 (oversized single block still paginates within the limit)
  it('Property 5: a single oversized annotation is split into pages each within the limit', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 30 }),
        fc.integer({ min: OBSIDIAN_TASK_LIMIT + 100, max: OBSIDIAN_TASK_LIMIT * 4 }),
        (docTitle, len) => {
          const huge: Annotation = {
            id: 'x',
            docId: 'doc',
            startSentenceIndex: 0,
            endSentenceIndex: 0,
            selectedText: '',
            comment: 'A'.repeat(len),
            aiReplies: [],
            createdAt: 't',
            updatedAt: 't',
          };
          const pages = buildBookNotePages(docTitle, [huge]);
          expect(pages.length).toBeGreaterThan(1);
          for (const page of pages) {
            expect(page.task.length).toBeLessThanOrEqual(OBSIDIAN_TASK_LIMIT);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: reader-workspace, Property 6: Pagination drops no annotation content (completeness)
  it('Property 6: concatenated page bodies contain every comment and reply', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 40 }),
        // Many annotations to force multiple pages; unique-token comments/replies.
        fc.array(annotationArb(), { minLength: 1, maxLength: 200 }),
        (docTitle, annotations) => {
          const pages = buildBookNotePages(docTitle, annotations);
          const allBodies = pages.map((p) => bodyOf(p.task)).join('');

          for (const a of annotations) {
            expect(allBodies).toContain(a.comment);
            for (const reply of a.aiReplies) {
              expect(allBodies).toContain(reply.content);
            }
          }
        },
      ),
      { numRuns: 120 },
    );
  });

  // Feature: reader-workspace, Property 7: Regeneration after delete reflows and truly removes content
  it('Property 7: removing an annotation removes its content; the rest remain', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 40 }),
        fc.array(annotationArb(), { minLength: 2, maxLength: 120 }),
        fc.nat(),
        (docTitle, annotations, pick) => {
          // Ensure unique comments across the set (uuid already unique, but guard).
          const removeIdx = pick % annotations.length;
          const removed = annotations[removeIdx];
          const remaining = annotations.filter((_, i) => i !== removeIdx);

          const pages = buildBookNotePages(docTitle, remaining);
          const allBodies = pages.map((p) => bodyOf(p.task)).join('');

          // Removed content is gone (unique token, so no coincidental match)...
          if (!remaining.some((a) => a.comment === removed.comment)) {
            expect(allBodies).not.toContain(removed.comment);
          }
          // ...and every remaining annotation's content is still present.
          for (const a of remaining) {
            expect(allBodies).toContain(a.comment);
          }
        },
      ),
      { numRuns: 120 },
    );
  });

  // Feature: reader-workspace, Property 8: Per-page Book_Note titles are stable across updates
  it('Property 8: page at index i always carries the deterministic title', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 50 }),
        fc.array(annotationArb(), { maxLength: 150 }),
        (docTitle, annotations) => {
          const pages = buildBookNotePages(docTitle, annotations);
          pages.forEach((page, i) => {
            expect(page.title).toBe(bookNotePageTitle(docTitle, i + 1));
          });
        },
      ),
      { numRuns: 150 },
    );
  });

  // Feature: reader-workspace, Property 9: Rendered block contains its passage, comment, and replies
  it('Property 9: rendered block contains passage, comment, and replies in order', () => {
    fc.assert(
      fc.property(
        annotationArb().filter((a) => a.comment.trim().length > 0),
        (annotation) => {
          const block = renderAnnotationBlock(annotation);
          expect(block).toContain(annotation.comment.trim());
          const passage = annotation.selectedText.trim();
          if (passage) {
            // Each passage line appears (quoted).
            for (const line of passage.split('\n')) {
              if (line) expect(block).toContain(line);
            }
          }
          // AI replies appear in order.
          let cursor = 0;
          for (const reply of annotation.aiReplies) {
            const content = reply.content.trim();
            if (!content) continue;
            const at = block.indexOf(content, cursor);
            expect(at).toBeGreaterThanOrEqual(0);
            cursor = at + content.length;
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
