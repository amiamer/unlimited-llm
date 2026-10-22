/**
 * Property-Based Tests for the annotation store.
 * Feature: reader-workspace
 *
 * Property 3: Annotation store round-trip
 * Property 4: Out-of-range annotations are omitted on load
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  saveAnnotations,
  loadAnnotations,
  filterRenderable,
} from '../annotation-store';
import type { Annotation } from '../types';

function installLocalStorageMock(): void {
  const backing = new Map<string, string>();
  const mock = {
    getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => Array.from(backing.keys())[i] ?? null,
    get length() {
      return backing.size;
    },
  };
  vi.stubGlobal('window', { localStorage: mock });
}

/** fast-check arbitrary for an AiReply. */
const aiReplyArb = fc.record({
  id: fc.uuid(),
  content: fc.string(),
  createdAt: fc.constant(new Date().toISOString()),
});

/**
 * fast-check arbitrary for an Annotation. Indices are kept small and ordered
 * (start <= end) so they model valid anchors; out-of-range behavior is driven
 * by the separately-generated sentence count.
 */
const annotationArb = (docId: string): fc.Arbitrary<Annotation> =>
  fc
    .tuple(fc.nat({ max: 1000 }), fc.nat({ max: 1000 }))
    .chain(([a, b]) => {
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      return fc.record({
        id: fc.uuid(),
        docId: fc.constant(docId),
        startSentenceIndex: fc.constant(start),
        endSentenceIndex: fc.constant(end),
        selectedText: fc.string(),
        comment: fc.string(),
        aiReplies: fc.array(aiReplyArb, { maxLength: 4 }),
        createdAt: fc.constant(new Date().toISOString()),
        updatedAt: fc.constant(new Date().toISOString()),
      });
    });

describe('annotation-store — property tests', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  // Feature: reader-workspace, Property 3: Annotation store round-trip.
  // loadAnnotations is async (IndexedDB primary, localStorage fallback); in the
  // node test env IndexedDB is absent so it falls back to the localStorage mock.
  it('Property 3: save then load returns an equivalent annotation list', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).chain((docId) =>
          fc.tuple(fc.constant(docId), fc.array(annotationArb(docId), { maxLength: 30 })),
        ),
        async ([docId, annotations]) => {
          installLocalStorageMock(); // fresh store per run
          saveAnnotations(docId, annotations);
          const loaded = await loadAnnotations(docId);
          // Deep structural equivalence (ids, anchors, comments, replies in order).
          expect(loaded).toEqual(annotations);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: reader-workspace, Property 4: Out-of-range annotations are omitted on load
  it('Property 4: filterRenderable keeps exactly the in-range annotations', () => {
    fc.assert(
      fc.property(
        fc.array(annotationArb('doc'), { maxLength: 40 }),
        fc.nat({ max: 1002 }),
        (annotations, sentenceCount) => {
          const result = filterRenderable(annotations, sentenceCount);

          const inRange = (a: Annotation) =>
            a.startSentenceIndex >= 0 &&
            a.startSentenceIndex <= a.endSentenceIndex &&
            a.endSentenceIndex < sentenceCount;

          // Result is exactly the in-range annotations, preserving order.
          expect(result).toEqual(annotations.filter(inRange));

          // Every returned annotation is genuinely within [0, sentenceCount).
          for (const a of result) {
            expect(inRange(a)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
