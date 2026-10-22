/**
 * Property-Based Tests for word-state derivation.
 * Feature: reader-workspace
 *
 * Property 10: Word-state derivation is a total, correct partition
 * Property 11: Word-state derivation falls back when mapping is unreliable
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { deriveWordStates } from '../word-state';

describe('word-state — property tests', () => {
  // Feature: reader-workspace, Property 10: Word-state derivation is a total, correct partition
  it('Property 10: states partition the sentence into read | {current} | unread', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 0, max: 80 }),
        (wordCount, pos) => {
          const words = Array.from({ length: wordCount }, (_, i) => `w${i}`);
          // tokenCount equals wordCount so it never triggers the fallback here.
          const states = deriveWordStates(words, wordCount, pos);
          expect(states).not.toBeNull();
          const s = states!;

          // Totality: one state per rendered word.
          expect(s).toHaveLength(wordCount);

          // At most one 'current'.
          const currents = s.filter((x) => x === 'current').length;
          expect(currents).toBeLessThanOrEqual(1);

          for (let i = 0; i < wordCount; i++) {
            if (i < pos) expect(s[i]).toBe('read');
            else if (i === pos) expect(s[i]).toBe('current');
            else expect(s[i]).toBe('unread');
          }

          // When pos is at/over the end, all words are read and there's no current.
          if (pos >= wordCount) {
            expect(s.every((x) => x === 'read')).toBe(true);
            expect(currents).toBe(0);
          } else {
            expect(currents).toBe(1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: reader-workspace, Property 10: current index advances monotonically
  it('Property 10: the current index moves forward as pos advances', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 40 }),
        (wordCount) => {
          const words = Array.from({ length: wordCount }, (_, i) => `w${i}`);
          let prevCurrent = -1;
          for (let pos = 0; pos < wordCount; pos++) {
            const s = deriveWordStates(words, wordCount, pos)!;
            const cur = s.indexOf('current');
            expect(cur).toBe(pos);
            expect(cur).toBeGreaterThan(prevCurrent);
            prevCurrent = cur;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: reader-workspace, Property 11: Word-state derivation falls back when mapping is unreliable
  it('Property 11: returns null for negative pos', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: -50, max: -1 }),
        (wordCount, pos) => {
          const words = Array.from({ length: wordCount }, (_, i) => `w${i}`);
          expect(deriveWordStates(words, wordCount, pos)).toBeNull();
        },
      ),
      { numRuns: 150 },
    );
  });

  // Feature: reader-workspace, Property 11: Word-state derivation falls back when mapping is unreliable
  it('Property 11: returns null when word/token counts diverge beyond tolerance', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 2, max: 30 }), // divergence strictly > default tolerance (1)
        (wordCount, pos, extraDivergence) => {
          const words = Array.from({ length: wordCount }, (_, i) => `w${i}`);
          const tokenCount = wordCount + extraDivergence;
          expect(deriveWordStates(words, tokenCount, pos)).toBeNull();
          // And the other direction.
          const tokenCountLess = Math.max(0, wordCount - extraDivergence);
          if (Math.abs(wordCount - tokenCountLess) > 1) {
            expect(deriveWordStates(words, tokenCountLess, pos)).toBeNull();
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  // Feature: reader-workspace, Property 11: within-tolerance divergence still derives (off-by-one ok)
  it('Property 11: off-by-one divergence is tolerated (non-null)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 0, max: 40 }), (wordCount, pos) => {
        const words = Array.from({ length: wordCount }, (_, i) => `w${i}`);
        // tokenCount off by exactly 1 → still within default tolerance.
        expect(deriveWordStates(words, wordCount + 1, pos)).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
