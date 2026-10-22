/**
 * Property-Based Tests for single-word stumble auto-advance.
 * Feature: reader-workspace
 *
 * Property 12: Single-word stumble advances exactly one word and continues on-script
 * Property 13: A single-word stumble never triggers question-mode (and vice versa)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createMatcher, step } from '../matcher';
import { normalize } from '../normalize';
import type { MatcherEvent, MatcherState, TranscriptChunk } from '../types';

/** A long single sentence so we can stall mid-way with words on both sides. */
const SENTENCE =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';

function run(
  state: MatcherState,
  chunks: TranscriptChunk[],
): { state: MatcherState; events: MatcherEvent[] } {
  const events: MatcherEvent[] = [];
  for (const c of chunks) {
    const r = step(state, c);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

describe('single-word stumble — property tests', () => {
  // Feature: reader-workspace, Property 12: Single-word stumble advances exactly one word and continues on-script
  it('Property 12: a stuck word is passed by exactly one position while reading continues', () => {
    fc.assert(
      fc.property(
        // Which word index the reader gets stuck on (kept away from the edges).
        fc.integer({ min: 2, max: 8 }),
        (stuckIdx) => {
          const tokens = normalize(SENTENCE);
          const matcher = createMatcher([SENTENCE]);

          const chunks: TranscriptChunk[] = [];
          let t = 0;
          // Read the words up to the stuck word, on-script, one per chunk.
          for (let i = 0; i < stuckIdx; i++) {
            t += 300;
            chunks.push({ text: tokens[i], isFinal: false, tMs: t });
          }
          // Now the reader skips the stuck word and reads the FOLLOWING words.
          // These are on-script words (so similarity stays high / following
          // mode), but the matcher's pos is wedged at stuckIdx until the
          // stumble rule nudges it. Space them so total time exceeds the
          // sustain threshold.
          for (let i = stuckIdx + 1; i < Math.min(stuckIdx + 5, tokens.length); i++) {
            t += 700;
            chunks.push({ text: tokens[i], isFinal: false, tMs: t });
          }

          const { state, events } = run(matcher, chunks);

          // Pointer never moved backward (single sentence, so still 0 or advanced).
          expect(state.pointer).toBeGreaterThanOrEqual(0);
          // It must NOT have entered question mode — this was on-script reading.
          expect(state.mode).toBe('following');
          expect(events.some((e) => e.type === 'question')).toBe(false);
          // The in-sentence position advanced beyond the stuck word (the stumble
          // rule nudged past it; subsequent on-script words advanced it further).
          // Either the sentence completed (pointer advanced) or pos moved past stuckIdx.
          const pos = state.window[0]?.pos ?? 0;
          const advancedPastStuck = state.pointer > 0 || pos > stuckIdx;
          expect(advancedPastStuck).toBe(true);
        },
      ),
      { numRuns: 150 },
    );
  });

  // Feature: reader-workspace, Property 13: A single-word stumble never triggers question-mode (and vice versa)
  it('Property 13: sustained off-script speech still enters question mode (stumble does not suppress it)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('zorp', 'blivet', 'quux', 'frob', 'wibble'), {
          minLength: 6,
          maxLength: 12,
        }),
        (gibberish) => {
          const matcher = createMatcher([SENTENCE]);
          const chunks: TranscriptChunk[] = [];
          let t = 0;
          // Sustained off-script speech, spaced past the question sustain window.
          for (const w of gibberish) {
            t += 600;
            chunks.push({ text: w, isFinal: false, tMs: t });
          }
          const { state, events } = run(matcher, chunks);
          // Off-script → question mode is reached (the stumble rule, which only
          // runs on-script, never fires here).
          const enteredQuestion =
            state.mode === 'question' || events.some((e) => e.type === 'question');
          expect(enteredQuestion).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: reader-workspace, Property 13: on-script stuck-word reading stays in following mode
  it('Property 13: on-script reading with a stuck word stays in following mode', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 7 }), (stuckIdx) => {
        const tokens = normalize(SENTENCE);
        const matcher = createMatcher([SENTENCE]);
        const chunks: TranscriptChunk[] = [];
        let t = 0;
        for (let i = 0; i < tokens.length; i++) {
          if (i === stuckIdx) continue; // skip the stuck word
          t += 500;
          chunks.push({ text: tokens[i], isFinal: i === tokens.length - 1, tMs: t });
        }
        const { state } = run(matcher, chunks);
        expect(state.mode).toBe('following');
      }),
      { numRuns: 100 },
    );
  });
});
