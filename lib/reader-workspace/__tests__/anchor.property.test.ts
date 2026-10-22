/**
 * Property-Based Tests for anchor derivation.
 * Feature: reader-workspace
 *
 * Property 1: Anchor range is ordered and within the document (sentence-granular)
 * Property 2: Empty or collapsed selections yield no anchor
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildAnchor, isAnchorWithinDoc } from '../anchor';

describe('anchor — property tests', () => {
  // Feature: reader-workspace, Property 1: Anchor range is ordered and within the document (sentence-granular)
  it('Property 1: anchor spans min..max of touched indices and is well-ordered', () => {
    fc.assert(
      fc.property(
        // A non-empty set of valid sentence indices and a sentence count that
        // comfortably contains them.
        fc.array(fc.nat({ max: 5000 }), { minLength: 1, maxLength: 40 }),
        fc.string(),
        (indices, selectedText) => {
          const anchor = buildAnchor(indices, selectedText);
          expect(anchor).not.toBeNull();
          const a = anchor!;

          const expectedMin = Math.min(...indices);
          const expectedMax = Math.max(...indices);

          // Spans exactly the min..max of the touched indices (sentence-granular).
          expect(a.startSentenceIndex).toBe(expectedMin);
          expect(a.endSentenceIndex).toBe(expectedMax);
          // Well-ordered.
          expect(a.startSentenceIndex).toBeLessThanOrEqual(a.endSentenceIndex);
          expect(a.startSentenceIndex).toBeGreaterThanOrEqual(0);
          // Selected text preserved verbatim.
          expect(a.selectedText).toBe(selectedText);

          // Within a doc whose count exceeds max.
          expect(isAnchorWithinDoc(a, expectedMax + 1)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: reader-workspace, Property 1: Anchor range is ordered and within the document (sentence-granular)
  it('Property 1: partial-sentence selections still anchor to whole sentences (single index → single-sentence span)', () => {
    fc.assert(
      fc.property(fc.nat({ max: 5000 }), fc.string({ minLength: 1 }), (index, text) => {
        // A selection that touches exactly one sentence (even partially) yields
        // a span covering that whole sentence: start === end === index.
        const anchor = buildAnchor([index], text);
        expect(anchor).not.toBeNull();
        expect(anchor!.startSentenceIndex).toBe(index);
        expect(anchor!.endSentenceIndex).toBe(index);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: reader-workspace, Property 2: Empty or collapsed selections yield no anchor
  it('Property 2: no touched sentence indices yields null', () => {
    fc.assert(
      fc.property(fc.string(), (selectedText) => {
        // Empty touched-index set → no anchor regardless of selected text.
        expect(buildAnchor([], selectedText)).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  // Feature: reader-workspace, Property 2: Empty or collapsed selections yield no anchor
  it('Property 2: only-invalid (negative/non-integer) indices yield null', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.integer({ min: -1000, max: -1 }),
            fc.double({ min: -1000, max: 1000, noInteger: true, noNaN: true }),
          ),
          { minLength: 1, maxLength: 20 },
        ),
        fc.string(),
        (invalidIndices, selectedText) => {
          expect(buildAnchor(invalidIndices, selectedText)).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});
