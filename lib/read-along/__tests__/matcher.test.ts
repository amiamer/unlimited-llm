/**
 * Scenario Tests for the Read-Along Matcher
 * Feature: read-along-alignment (Phase 1)
 *
 * Simulates chunked STT transcripts against a ~10-sentence banking fixture:
 * - clean read-through (several chunkings)
 * - a skipped sentence (SKIMMED + pointer jump)
 * - an off-script question mid-paragraph, then resuming
 * - a noisy read (misheard words + filler insertions)
 * - silence / empty chunks as non-events
 */

import { describe, it, expect } from 'vitest';
import { createMatcher, step } from '../matcher';
import type { MatcherEvent, MatcherState, TranscriptChunk } from '../types';
import { FIXTURE_SENTENCES, FIXTURE_WORDS } from './fixture';

function chunk(text: string, tMs: number, isFinal = false): TranscriptChunk {
  return { text, isFinal, tMs };
}

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

describe('heading auto-skip', () => {
  it('skims a heading the reader never voices and continues', () => {
    // Sentence 1 is a heading ("Etymology") nobody reads aloud. The reader
    // goes straight from sentence 0 into sentence 2's text.
    const sentences = [
      'capitalism is an economic system based on private ownership',
      'Etymology',
      'the word capital comes from the latin caput meaning head',
    ];
    const headingFlags = [false, true, false];
    const state = createMatcher(sentences, headingFlags);

    const { state: end, events } = run(state, [
      chunk('capitalism is an economic system based on private ownership', 0, true),
      chunk('the word capital comes from the latin caput meaning head', 1500, true),
    ]);

    // Heading (index 1) is skimmed, not stuck on.
    expect(eventsOf(events, 'skim').map((e) => e.index)).toContain(1);
    expect(end.states[0]).toBe('read_aloud');
    expect(end.states[1]).toBe('skimmed');
    expect(end.states[2]).toBe('read_aloud');
    expect(end.pointer).toBe(3);
  });
});


/** Split a word list into fixed-size text chunks; the last one is isFinal. */
function chunkWords(words: string[], size: number, msPerChunk = 400): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  for (let i = 0; i < words.length; i += size) {
    chunks.push(chunk(words.slice(i, i + size).join(' '), (chunks.length + 1) * msPerChunk));
  }
  if (chunks.length > 0) chunks[chunks.length - 1].isFinal = true;
  return chunks;
}

describe('read-along matcher — scenarios', () => {
  describe('clean read-through', () => {
    it('advances through every sentence, one chunk per sentence', () => {
      const chunks = FIXTURE_SENTENCES.map((s, i) => chunk(s, i * 2500, true));
      const { state, events } = run(createMatcher(FIXTURE_SENTENCES), chunks);

      expect(state.pointer).toBe(FIXTURE_SENTENCES.length);
      expect(state.states.every((s) => s === 'read_aloud')).toBe(true);
      expect(state.mode).toBe('following');

      const advances = eventsOf(events, 'advance');
      expect(advances.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(events.some((e) => e.type === 'skim')).toBe(false);
      expect(events.some((e) => e.type === 'question')).toBe(false);
    });

    it('advances identically when fed word by word', () => {
      const { state, events } = run(
        createMatcher(FIXTURE_SENTENCES),
        chunkWords(FIXTURE_WORDS, 1, 200),
      );

      expect(state.pointer).toBe(FIXTURE_SENTENCES.length);
      expect(state.states.every((s) => s === 'read_aloud')).toBe(true);
      expect(events.filter((e) => e.type === 'advance')).toHaveLength(10);
      expect(events.some((e) => e.type === 'question')).toBe(false);
    });

    it('advances identically when the whole document arrives in one chunk', () => {
      const { state } = run(createMatcher(FIXTURE_SENTENCES), [
        chunk(FIXTURE_WORDS.join(' '), 1000, true),
      ]);

      expect(state.pointer).toBe(FIXTURE_SENTENCES.length);
      expect(state.states.every((s) => s === 'read_aloud')).toBe(true);
    });

    it('matches spoken number words against document digits ("two percent" vs "2%")', () => {
      const spoken = FIXTURE_SENTENCES[0].replace('2%', 'two percent');
      const { state, events } = run(createMatcher(FIXTURE_SENTENCES), [
        chunk(spoken, 1000, true),
      ]);

      expect(eventsOf(events, 'advance').map((e) => e.index)).toEqual([0]);
      expect(state.pointer).toBe(1);
      expect(state.states[0]).toBe('read_aloud');
    });
  });

  describe('skipped sentence', () => {
    it('marks the skipped sentence SKIMMED and jumps the pointer', () => {
      const spoken = [0, 1, 3, 4, 5, 6, 7, 8, 9].map((i) => FIXTURE_SENTENCES[i]);
      const chunks = spoken.map((s, i) => chunk(s, i * 2500, true));
      const { state, events } = run(createMatcher(FIXTURE_SENTENCES), chunks);

      const skims = eventsOf(events, 'skim');
      expect(skims).toHaveLength(1);
      expect(skims[0].index).toBe(2);

      expect(state.pointer).toBe(FIXTURE_SENTENCES.length);
      expect(state.states[2]).toBe('skimmed');
      expect(
        state.states.filter((_, i) => i !== 2).every((s) => s === 'read_aloud'),
      ).toBe(true);
      expect(events.some((e) => e.type === 'question')).toBe(false);

      // The skim must be reported before the skipped-to sentence advances.
      const skimAt = events.findIndex((e) => e.type === 'skim');
      const advance3At = events.findIndex(
        (e) => e.type === 'advance' && e.index === 3,
      );
      expect(skimAt).toBeLessThan(advance3At);
    });

    it('marks two consecutive skipped sentences SKIMMED', () => {
      const spoken = [0, 1, 4, 5, 6, 7, 8, 9].map((i) => FIXTURE_SENTENCES[i]);
      const chunks = spoken.map((s, i) => chunk(s, i * 2500, true));
      const { state, events } = run(createMatcher(FIXTURE_SENTENCES), chunks);

      const skimIndices = eventsOf(events, 'skim').map((e) => e.index);
      expect(skimIndices).toEqual([2, 3]);
      expect(state.states[2]).toBe('skimmed');
      expect(state.states[3]).toBe('skimmed');
      expect(state.pointer).toBe(FIXTURE_SENTENCES.length);
    });
  });

  describe('off-script question and resume', () => {
    it('emits one question after >1.5s of sustained mismatch, then resumes', () => {
      const matcher = createMatcher(FIXTURE_SENTENCES);

      // Read the first four sentences cleanly → pointer at 4.
      const prefix = [0, 1, 2, 3].map((i) => chunk(FIXTURE_SENTENCES[i], i * 2500, true));
      let { state, events } = run(matcher, prefix);
      expect(state.pointer).toBe(4);

      // Off-script speech split across two chunks spanning more than 1.5s.
      const q1 = step(state, chunk('wait what does this even mean', 10_000));
      state = q1.state;
      expect(q1.events).toHaveLength(0); // mismatch run started, not sustained yet
      expect(state.mode).toBe('following');

      const q2 = step(state, chunk('i dont understand this part at all', 11_800));
      state = q2.state;
      const questions = eventsOf(q2.events, 'question');
      expect(questions).toHaveLength(1);
      expect(questions[0].anchorIndex).toBe(4);
      expect(questions[0].utterance).toContain('wait what does this even mean');
      expect(questions[0].utterance).toContain('i dont understand this part at all');
      expect(state.mode).toBe('question');
      expect(state.pointer).toBe(4); // anchor sentence untouched

      // Resume: the reader picks the text back up at sentence 4.
      const r = step(state, chunk(FIXTURE_SENTENCES[4], 16_000, true));
      state = r.state;
      expect(r.events[0]).toEqual({ type: 'resume' });
      expect(
        r.events.some((e) => e.type === 'advance' && e.index === 4),
      ).toBe(true);
      expect(state.mode).toBe('following');

      // And the rest of the document still completes.
      const rest = [5, 6, 7, 8, 9].map((i) =>
        chunk(FIXTURE_SENTENCES[i], 18_000 + i * 2500, true),
      );
      const done = run(state, rest);
      expect(done.state.pointer).toBe(FIXTURE_SENTENCES.length);
      expect(done.state.states.every((s) => s === 'read_aloud')).toBe(true);
      expect(done.events.some((e) => e.type === 'question')).toBe(false);
    });

    it('keeps buffering while in question mode without emitting more questions', () => {
      const prefix = [0, 1].map((i) => chunk(FIXTURE_SENTENCES[i], i * 2500, true));
      let { state } = run(createMatcher(FIXTURE_SENTENCES), prefix);

      state = step(state, chunk('hmm hold on a second here', 6000)).state;
      const fired = step(state, chunk('why would lenders even do something like this', 7700));
      state = fired.state;
      expect(fired.events.filter((e) => e.type === 'question')).toHaveLength(1);

      // More off-script speech while in question mode: buffered, no new event.
      const more = step(state, chunk('seriously i am quite confused right now', 9000));
      state = more.state;
      expect(more.events).toHaveLength(0);
      expect(state.mode).toBe('question');
      expect(state.pointer).toBe(2); // pointer pinned while off-script
    });

    it('a brief mismatch (single chunk, short span) never fires a question', () => {
      const prefix = [0, 1].map((i) => chunk(FIXTURE_SENTENCES[i], i * 2500, true));
      let { state } = run(createMatcher(FIXTURE_SENTENCES), prefix);

      // One mumbled chunk, then straight back to reading within 1.5s.
      const mumble = step(state, chunk('uh hmm something', 6000));
      state = mumble.state;
      expect(mumble.events).toHaveLength(0);

      const back = step(state, chunk(FIXTURE_SENTENCES[2], 6900, true));
      expect(back.events.some((e) => e.type === 'question')).toBe(false);
      expect(back.events.some((e) => e.type === 'advance' && e.index === 2)).toBe(true);
      expect(back.state.mode).toBe('following');
    });
  });

  describe('hard / untranscribable words (foreign terms, names)', () => {
    it('does not enter question mode while still tracking despite low-score chunks', () => {
      // Each chunk is mostly STT junk (so its per-chunk score stays under the
      // question threshold) but still matches the expected text in order. The
      // junk run spans well past the 1.5s question window. Before the fix this
      // tripped a false 'question'; now the in-order tracking keeps it FOLLOWING.
      const sentences = [
        'the reader embraced the german concept fully',
        'it shaped his entire worldview thereafter',
      ];
      const state = createMatcher(sentences);

      const { state: end, events } = run(state, [
        chunk('the reader blarg gloop snarf wobble bork', 0),
        chunk('embraced the blarg gloop snarf wobble bork', 1000),
        chunk('german concept blarg gloop snarf wobble bork', 2200),
        chunk('fully blarg gloop snarf wobble bork zarp', 3600, true),
      ]);

      expect(events.some((e) => e.type === 'question')).toBe(false);
      expect(end.mode).toBe('following');
      expect(end.pointer).toBeGreaterThanOrEqual(1); // advanced past the hard sentence
    });

    it('still fires a question for genuinely off-script speech (no tracking)', () => {
      // Sanity guard: the fix must not suppress real questions. Disjoint
      // vocabulary → zero in-order matches → question still fires.
      const prefix = [0, 1].map((i) => chunk(FIXTURE_SENTENCES[i], i * 2500, true));
      let { state } = run(createMatcher(FIXTURE_SENTENCES), prefix);

      state = step(state, chunk('zorp blivet quux frobnitz', 6000)).state;
      const fired = step(state, chunk('wibble snarf glorp zubzub', 7800));
      expect(fired.events.some((e) => e.type === 'question')).toBe(true);
    });
  });

  describe('noisy read', () => {
    it('reaches the end despite misheard words and filler insertions', () => {
      // Mishear a few words and sprinkle filler — roughly what cheap STT does.
      const noisy = FIXTURE_WORDS.map((w) => {
        if (w === 'meaningful') return 'meaningfull';
        if (w === 'liquidity') return 'liquid';
        if (w === 'debated') return 'debating';
        if (w === 'considerable') return 'considerble';
        return w;
      });
      noisy.splice(20, 0, 'um');
      noisy.splice(55, 0, 'uh');
      noisy.splice(90, 0, 'erm');

      const { state, events } = run(
        createMatcher(FIXTURE_SENTENCES),
        chunkWords(noisy, 6),
      );

      expect(state.pointer).toBe(FIXTURE_SENTENCES.length);
      expect(state.states.every((s) => s === 'read_aloud')).toBe(true);
      expect(events.some((e) => e.type === 'question')).toBe(false);
      expect(events.some((e) => e.type === 'skim')).toBe(false);
    });
  });

  describe('silence and degenerate input', () => {
    it('empty and punctuation-only chunks produce no events and no state change', () => {
      const initial = createMatcher(FIXTURE_SENTENCES);
      for (const text of ['', '   ', '...', '?!']) {
        const { state, events } = step(initial, chunk(text, 5000, true));
        expect(events).toEqual([]);
        expect(state).toBe(initial); // exact same reference — true no-op
      }
    });

    it('chunks after the document is finished are ignored', () => {
      const chunks = FIXTURE_SENTENCES.map((s, i) => chunk(s, i * 2500, true));
      const { state } = run(createMatcher(FIXTURE_SENTENCES), chunks);
      expect(state.pointer).toBe(FIXTURE_SENTENCES.length);

      const after = step(state, chunk('and now for something completely different', 99_000));
      expect(after.events).toEqual([]);
      expect(after.state.pointer).toBe(FIXTURE_SENTENCES.length);
    });
  });
});
