/**
 * Property-Based Tests for the Read-Along Matcher
 * Feature: read-along-alignment (Phase 1)
 *
 * Property A: Completeness — feeding a document's own words as chunks, under
 *             ANY chunking split, always ends with pointer === sentences.length
 *             and every sentence 'read_aloud'.
 * Property B: Monotonicity — the pointer never decreases across arbitrary
 *             chunk sequences.
 * Property C: Noise tolerance — with ≤10% random token substitution (at most
 *             one substituted word per sentence), a full read still advances
 *             to the end of the document.
 * Property D: Question detection — an injected off-script utterance of ≥8
 *             tokens spanning >1.5s always produces exactly one 'question'
 *             event whose utterance contains the injected tokens.
 * Property E: State integrity — the per-sentence state array never changes
 *             length, and 'read_aloud' / 'skimmed' are terminal states.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createMatcher, step } from '../matcher';
import { normalize } from '../normalize';
import type { MatcherEvent, MatcherState, TranscriptChunk } from '../types';
import { FIXTURE_SENTENCES, FIXTURE_WORDS } from './fixture';

/** Filter events by type with proper union narrowing. */
function eventsOf<T extends MatcherEvent['type']>(
  events: MatcherEvent[],
  type: T,
): Extract<MatcherEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<MatcherEvent, { type: T }> => e.type === type,
  );
}

/** Feed chunks through the matcher, collecting every event. */
function run(
  state: MatcherState,
  chunks: TranscriptChunk[],
): { state: MatcherState; events: MatcherEvent[] } {
  const events: MatcherEvent[] = [];
  for (const c of chunks) {
    const result = step(state, c);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

/**
 * Partition a word list into chunks using the given sizes (cycled if
 * exhausted). The last chunk is marked isFinal, timestamps are evenly spaced.
 */
function partition(words: string[], sizes: number[], msPerChunk = 300): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let i = 0;
  let s = 0;
  while (i < words.length) {
    const size = sizes[s % sizes.length] || 1;
    chunks.push({
      text: words.slice(i, i + size).join(' '),
      isFinal: false,
      tMs: (chunks.length + 1) * msPerChunk,
    });
    i += size;
    s++;
  }
  if (chunks.length > 0) chunks[chunks.length - 1].isFinal = true;
  return chunks;
}

/** Word pool for arbitrary (not-necessarily-on-script) chunk sequences. */
const MIXED_POOL = [
  ...new Set(FIXTURE_SENTENCES.flatMap((s) => normalize(s))),
  'zorp', 'blivet', 'quux', 'frob', 'wibble', 'um', 'uh',
];

describe('Read-Along Matcher Property-Based Tests', () => {
  /**
   * Property A: Completeness under arbitrary chunking
   *
   * *For any* way of splitting the document's own words into chunks, feeding
   * them in order SHALL end with the pointer past the last sentence and every
   * sentence marked 'read_aloud'.
   */
  it('Property A: any chunking of a clean read reaches the end with all sentences read_aloud', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 40 }),
        (sizes: number[]) => {
          const { state } = run(
            createMatcher(FIXTURE_SENTENCES),
            partition(FIXTURE_WORDS, sizes),
          );

          expect(state.pointer).toBe(FIXTURE_SENTENCES.length);
          expect(state.states.every((s) => s === 'read_aloud')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property B: Pointer monotonicity
   *
   * *For any* sequence of chunks — on-script, off-script, or gibberish — the
   * pointer SHALL never move backward.
   */
  it('Property B: pointer is monotonically non-decreasing across arbitrary chunk sequences', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            words: fc.array(fc.constantFrom(...MIXED_POOL), { maxLength: 10 }),
            gapMs: fc.integer({ min: 0, max: 2500 }),
            isFinal: fc.boolean(),
          }),
          { maxLength: 30 },
        ),
        (specs) => {
          let state = createMatcher(FIXTURE_SENTENCES);
          let tMs = 0;
          for (const spec of specs) {
            tMs += spec.gapMs;
            const before = state.pointer;
            state = step(state, {
              text: spec.words.join(' '),
              isFinal: spec.isFinal,
              tMs,
            }).state;

            expect(state.pointer).toBeGreaterThanOrEqual(before);
            expect(state.pointer).toBeLessThanOrEqual(FIXTURE_SENTENCES.length);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property C: Noise tolerance
   *
   * *For any* placement of misheard words (at most one substituted word per
   * sentence — ≤10% of the document) and any uniform chunk size, a full read
   * SHALL still advance the pointer to the end of the document.
   */
  it('Property C: a full read with <=10% token substitution noise still advances to the end', () => {
    const substitutionArbs = FIXTURE_SENTENCES.map((s) =>
      // -1 = no substitution in this sentence; otherwise the word index to garble
      fc.integer({ min: -1, max: s.split(' ').length - 1 }),
    );

    fc.assert(
      fc.property(
        fc.tuple(...substitutionArbs),
        fc.integer({ min: 1, max: 8 }),
        (substitutions: number[], chunkSize: number) => {
          const noisyWords: string[] = [];
          FIXTURE_SENTENCES.forEach((sentence, si) => {
            const words = sentence.split(' ');
            words.forEach((w, wi) => {
              noisyWords.push(wi === substitutions[si] ? `qzmisheard${si}` : w);
            });
          });

          const { state } = run(
            createMatcher(FIXTURE_SENTENCES),
            partition(noisyWords, [chunkSize]),
          );

          expect(state.pointer).toBe(FIXTURE_SENTENCES.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property D: Question detection
   *
   * *For any* off-script utterance of ≥8 tokens (disjoint from the document
   * vocabulary) split across chunks whose timestamps span >1.5s, the matcher
   * SHALL emit exactly one 'question' event, anchored at the current pointer,
   * whose utterance contains every injected token.
   */
  it('Property D: a sustained off-script utterance produces exactly one question with the full utterance', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 8, max: 16 }), // injected token count
        fc.integer({ min: 2, max: 4 }), // chunk count
        fc.array(fc.integer({ min: 50, max: 150 }), { minLength: 3, maxLength: 3 }),
        fc.integer({ min: 1501, max: 4000 }), // the gap that crosses 1.5s
        (tokenCount, chunkCount, middleGaps, finalGap) => {
          // Read the first three sentences cleanly → pointer at 3.
          const prefix = [0, 1, 2].map((i) => ({
            text: FIXTURE_SENTENCES[i],
            isFinal: true,
            tMs: i * 2000,
          }));
          let { state } = run(createMatcher(FIXTURE_SENTENCES), prefix);
          expect(state.pointer).toBe(3);

          // Build the off-script utterance from a disjoint vocabulary,
          // balanced-split so every chunk is non-empty (tokenCount >= chunkCount).
          const injected = Array.from({ length: tokenCount }, (_, i) => `qzoff${i}`);
          const gaps = [...middleGaps.slice(0, chunkCount - 2), finalGap];

          let tMs = 10_000;
          const allEvents: MatcherEvent[] = [];
          for (let c = 0; c < chunkCount; c++) {
            if (c > 0) tMs += gaps[c - 1];
            const from = Math.round((c * tokenCount) / chunkCount);
            const to = Math.round(((c + 1) * tokenCount) / chunkCount);
            const words = injected.slice(from, to);
            const result = step(state, { text: words.join(' '), isFinal: false, tMs });
            state = result.state;
            allEvents.push(...result.events);
          }

          const questions = eventsOf(allEvents, 'question');
          expect(questions).toHaveLength(1);
          expect(questions[0].anchorIndex).toBe(3);
          for (const token of injected) {
            expect(questions[0].utterance).toContain(token);
          }
          expect(state.mode).toBe('question');
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property E: State integrity
   *
   * *For any* sequence of chunks, the per-sentence state array SHALL keep its
   * length, and states SHALL only ever transition out of 'unread' —
   * 'read_aloud' and 'skimmed' are terminal.
   */
  it('Property E: state arrays never change length and read states are terminal', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            words: fc.array(fc.constantFrom(...MIXED_POOL), { maxLength: 10 }),
            gapMs: fc.integer({ min: 0, max: 2500 }),
            isFinal: fc.boolean(),
          }),
          { maxLength: 30 },
        ),
        (specs) => {
          let state = createMatcher(FIXTURE_SENTENCES);
          let tMs = 0;
          for (const spec of specs) {
            tMs += spec.gapMs;
            const before = state.states;
            state = step(state, {
              text: spec.words.join(' '),
              isFinal: spec.isFinal,
              tMs,
            }).state;

            expect(state.states).toHaveLength(FIXTURE_SENTENCES.length);
            before.forEach((prev, i) => {
              const next = state.states[i];
              if (prev === 'read_aloud') expect(next).toBe('read_aloud');
              if (prev === 'skimmed') expect(next).toBe('skimmed');
            });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
