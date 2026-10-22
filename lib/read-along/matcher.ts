/**
 * Read-along alignment engine — the matcher.
 * Feature: read-along-alignment (Phase 1: pure module — no STT, no UI)
 *
 * createMatcher(sentences) builds an immutable MatcherState; step(state, chunk)
 * returns a NEW state plus the events the chunk produced. No wall-clock reads,
 * no mutation of the input state.
 *
 * Matching model
 * --------------
 * Tokens are consumed incrementally against a 3-sentence window
 * (sentences[pointer .. pointer+2]). Each window sentence tracks in-order
 * progress: `pos` (next expected token index) and `matched` (tokens matched in
 * order so far). A transcript token is tried against sentence[pointer] first,
 * within a small lookahead of `pos` (which bridges misheard words), then
 * against the next two sentences. This is a greedy in-order (LCS-style)
 * overlap — never bag-of-words — computed incrementally so each step is
 * O(chunk tokens × window), independent of document size.
 *
 * Advance rules (sentence[pointer] becomes 'read_aloud', pointer++):
 *  (a) ≥70% of its tokens matched in order AND its position fully traversed
 *  (b) ≥70% matched AND the next sentence has begun matching (≥2 tokens) —
 *      rescues sentences whose tail tokens were misheard
 *  (d) ≥70% matched AND the chunk is utterance-final (isFinal) — rescues the
 *      last sentence of a document with a misheard final word
 *
 * Skip rule (c): if a later window sentence reaches its own 70% threshold
 * while sentence[pointer] hasn't, the reader skipped — intermediate sentences
 * are marked 'skimmed' and the pointer jumps.
 *
 * Question mode: chunk similarity (matched tokens / chunk tokens) < 0.4
 * sustained for > 1.5s of continued speech emits a 'question' with the
 * accumulated unmatched utterance, anchored at the current pointer. While in
 * question mode the matcher keeps buffering; the first chunk that matches the
 * expected window again (score ≥ 0.4 with ≥2 matched tokens) emits 'resume'.
 *
 * Silence is the absence of chunks — it never produces an event.
 * The pointer never moves backward.
 */

import { normalize } from './normalize';
import type {
  MatcherEvent,
  MatcherState,
  SentenceState,
  TranscriptChunk,
  WindowProgress,
} from './types';

/** Rolling transcript buffer length (informational / phase-2 debugging). */
const BUFFER_SIZE = 12;
/** How many sentences ahead of the pointer participate in matching. */
const WINDOW_SIZE = 3;
/** How far past `pos` a token may match — bridges misheard/skipped words. */
const LOOKAHEAD = 4;
/** Fraction of a sentence's tokens that must match in order to advance. */
const ADVANCE_RATIO = 0.7;
/** Chunk similarity below this counts toward question-mode detection. */
const QUESTION_SCORE_THRESHOLD = 0.4;
/** Sustained mismatch duration (ms) that triggers question mode. */
const QUESTION_SUSTAIN_MS = 1500;
/** Matches in the NEXT sentence that confirm the current one is finished. */
const NEXT_SENTENCE_CONFIRM_TOKENS = 2;
/** Minimum matched tokens for a chunk to end question mode (anti-stopword). */
const RESUME_MIN_MATCHED = 2;
/**
 * Sustained time (ms) the in-sentence position may stay wedged on a single
 * word while the reader is otherwise on-script before the matcher nudges past
 * that one word (single-word stumble auto-advance — Req 13). Conservative.
 */
const STUMBLE_SUSTAIN_MS = 1200;

interface Draft {
  pointer: number;
  states: SentenceState[];
  window: WindowProgress[];
}

function advanceThreshold(sentenceLength: number): number {
  return Math.max(1, Math.ceil(sentenceLength * ADVANCE_RATIO));
}

function freshProgress(): WindowProgress {
  return { matched: 0, pos: 0 };
}

function shiftWindow(window: WindowProgress[], by: number): void {
  for (let i = 0; i < by; i++) {
    window.shift();
    window.push(freshProgress());
  }
}

/**
 * Try to match one transcript token against the window, nearest sentence
 * first, in order, within LOOKAHEAD of each sentence's current position.
 */
function tryMatchToken(
  sentences: string[][],
  draft: Draft,
  token: string,
): boolean {
  for (let k = 0; k < WINDOW_SIZE; k++) {
    const sentenceIndex = draft.pointer + k;
    if (sentenceIndex >= sentences.length) break;
    const sentence = sentences[sentenceIndex];
    const progress = draft.window[k];
    const end = Math.min(progress.pos + LOOKAHEAD, sentence.length);
    for (let i = progress.pos; i < end; i++) {
      if (sentence[i] === token) {
        progress.matched++;
        progress.pos = i + 1;
        return true;
      }
    }
  }
  return false;
}

/** Apply advance/skip rules repeatedly until none fires. */
function settle(
  sentences: string[][],
  skippable: boolean[],
  draft: Draft,
  events: MatcherEvent[],
  atFinalBoundary: boolean,
): void {
  while (draft.pointer < sentences.length) {
    const current = sentences[draft.pointer];

    // Degenerate sentence (normalized to zero tokens) can never be spoken.
    if (current.length === 0) {
      events.push({ type: 'skim', index: draft.pointer });
      draft.states[draft.pointer] = 'skimmed';
      draft.pointer++;
      shiftWindow(draft.window, 1);
      continue;
    }

    const progress = draft.window[0];
    const threshold = advanceThreshold(current.length);
    const hasNext = draft.pointer + 1 < sentences.length;

    // Heading auto-skip: readers don't voice headings, so if the current
    // sentence is skippable and the NEXT sentence has begun matching (or this
    // skippable one barely matched), skim it rather than stalling forever.
    if (
      skippable[draft.pointer] &&
      progress.matched < threshold &&
      hasNext &&
      draft.window[1].matched >= 1
    ) {
      events.push({ type: 'skim', index: draft.pointer });
      draft.states[draft.pointer] = 'skimmed';
      draft.pointer++;
      shiftWindow(draft.window, 1);
      continue;
    }

    const completed = progress.matched >= threshold && progress.pos >= current.length; // (a)
    const confirmedByNext =
      progress.matched >= threshold &&
      hasNext &&
      draft.window[1].matched >= NEXT_SENTENCE_CONFIRM_TOKENS; // (b)
    const finalized = atFinalBoundary && progress.matched >= threshold; // (d)

    if (completed || confirmedByNext || finalized) {
      events.push({ type: 'advance', index: draft.pointer });
      draft.states[draft.pointer] = 'read_aloud';
      draft.pointer++;
      shiftWindow(draft.window, 1);
      continue;
    }

    // (c) Skip detection: a later window sentence hit its own threshold
    // while the current one didn't — the reader jumped ahead.
    let jumped = false;
    for (let k = 1; k < WINDOW_SIZE; k++) {
      const sentenceIndex = draft.pointer + k;
      if (sentenceIndex >= sentences.length) break;
      if (draft.window[k].matched >= advanceThreshold(sentences[sentenceIndex].length)) {
        for (let j = 0; j < k; j++) {
          events.push({ type: 'skim', index: draft.pointer + j });
          draft.states[draft.pointer + j] = 'skimmed';
        }
        draft.pointer += k;
        shiftWindow(draft.window, k);
        jumped = true;
        break;
      }
    }
    if (!jumped) break;
  }
}

/** Consume a chunk's tokens into the draft. Returns how many tokens matched. */
function consume(
  sentences: string[][],
  skippable: boolean[],
  draft: Draft,
  tokens: string[],
  isFinal: boolean,
  events: MatcherEvent[],
): number {
  let matchedCount = 0;
  for (const token of tokens) {
    if (draft.pointer >= sentences.length) break;
    if (tryMatchToken(sentences, draft, token)) matchedCount++;
    settle(sentences, skippable, draft, events, false);
  }
  if (isFinal) settle(sentences, skippable, draft, events, true);
  return matchedCount;
}

export function createMatcher(
  sentences: string[],
  skippable?: boolean[],
): MatcherState {
  return {
    sentences: sentences.map(normalize),
    skippable: sentences.map((_, i) => skippable?.[i] ?? false),
    pointer: 0,
    states: sentences.map(() => 'unread' as SentenceState),
    buffer: [],
    mode: 'following',
    window: Array.from({ length: WINDOW_SIZE }, freshProgress),
    mismatchSinceMs: null,
    pendingUtterance: [],
    posStalledSinceMs: null,
    stalledAtPos: null,
  };
}

/**
 * Manually move the pointer to `index` (a deliberate user skip/jump — distinct
 * from automatic voice advancement). Sentences before the target that were
 * still 'unread' become 'skimmed' (you jumped past them); already-read
 * sentences keep their state. Backward jumps are allowed since this is explicit
 * user intent. The match window and question-mode state are reset so alignment
 * resumes cleanly from the new position. Pure: returns a new state.
 */
export function seek(state: MatcherState, index: number): MatcherState {
  const clamped = Math.max(0, Math.min(index, state.sentences.length));
  const states = [...state.states];
  for (let i = 0; i < clamped; i++) {
    if (states[i] === 'unread') states[i] = 'skimmed';
  }
  return {
    ...state,
    pointer: clamped,
    states,
    window: Array.from({ length: WINDOW_SIZE }, freshProgress),
    mode: 'following',
    mismatchSinceMs: null,
    pendingUtterance: [],
    posStalledSinceMs: null,
    stalledAtPos: null,
    buffer: [],
  };
}

export function step(
  state: MatcherState,
  chunk: TranscriptChunk,
): { state: MatcherState; events: MatcherEvent[] } {
  const tokens = normalize(chunk.text);
  if (tokens.length === 0) {
    // Silence (or punctuation-only noise) is just a pause — never an event.
    return { state, events: [] };
  }

  const buffer = [...state.buffer, ...tokens].slice(-BUFFER_SIZE);

  if (state.pointer >= state.sentences.length) {
    // Document finished — nothing left to align against.
    return { state: { ...state, buffer }, events: [] };
  }

  // Work on copies; `state` is never mutated.
  const draft: Draft = {
    pointer: state.pointer,
    states: [...state.states],
    window: state.window.map((p) => ({ ...p })),
  };
  const events: MatcherEvent[] = [];
  const matchedCount = consume(state.sentences, state.skippable, draft, tokens, chunk.isFinal, events);
  const score = matchedCount / tokens.length;

  if (state.mode === 'question') {
    if (score >= QUESTION_SCORE_THRESHOLD && matchedCount >= RESUME_MIN_MATCHED) {
      // Reader is back on script: commit the tentative consumption.
      return {
        state: {
          ...state,
          pointer: draft.pointer,
          states: draft.states,
          window: draft.window,
          buffer,
          mode: 'following',
          mismatchSinceMs: null,
          pendingUtterance: [],
        },
        events: [{ type: 'resume' }, ...events],
      };
    }
    // Still off-script: keep buffering, discard the tentative consumption so
    // stray matches inside the question can't drag the window forward.
    return {
      state: {
        ...state,
        buffer,
        pendingUtterance: [...state.pendingUtterance, chunk.text],
      },
      events: [],
    };
  }

  // mode === 'following' — consumption always commits.
  //
  // A low chunk score is ambiguous: it can be a genuine off-script question, or
  // just a rough patch — a word STT can't transcribe (a foreign term, a name).
  // If we're still clearly tracking the text — the pointer advanced this chunk,
  // or several tokens matched in order within the expected window — it's a hard
  // word, not a question. We must NOT let it accumulate toward a question
  // trigger, which would pin the pointer and "lose track" mid-read.
  const stillTracking =
    draft.pointer > state.pointer || matchedCount >= RESUME_MIN_MATCHED;

  if (score < QUESTION_SCORE_THRESHOLD && !stillTracking) {
    const runStart = state.mismatchSinceMs ?? chunk.tMs;
    const pendingUtterance = [...state.pendingUtterance, chunk.text];
    const sustained = chunk.tMs - runStart > QUESTION_SUSTAIN_MS;
    if (sustained) {
      events.push({
        type: 'question',
        utterance: pendingUtterance.join(' ').trim(),
        anchorIndex: draft.pointer,
      });
    }
    return {
      state: {
        ...state,
        pointer: draft.pointer,
        states: draft.states,
        window: draft.window,
        buffer,
        mode: sustained ? 'question' : 'following',
        mismatchSinceMs: runStart,
        pendingUtterance,
      },
      events,
    };
  }

  // On-script chunk: any mismatch run is over. Before committing, check for a
  // single-word stumble — the reader is on-script but window[0].pos is wedged on
  // one token (misheard / hard-to-pronounce word) while matching otherwise
  // progresses. We nudge past exactly that one word so the highlight doesn't
  // stall. This is the OPPOSITE of question-mode (which is sustained off-script
  // speech) and only runs here, in the on-script branch.
  let posStalledSinceMs: number | null = state.posStalledSinceMs;
  let stalledAtPos: number | null = state.stalledAtPos;

  if (draft.pointer < draft.window.length) {
    const curPos = draft.window[0]?.pos ?? 0;
    const pointerUnchanged = draft.pointer === state.pointer;

    if (pointerUnchanged && stalledAtPos === curPos && posStalledSinceMs !== null) {
      // pos has not advanced since the stall run started.
      const stalledLongEnough = chunk.tMs - posStalledSinceMs > STUMBLE_SUSTAIN_MS;
      // Forward-progress evidence: this chunk matched tokens (reader is reading
      // on), or a later window sentence has begun matching — i.e. only this one
      // word at `pos` is stuck, not the whole sentence.
      const progressingPastStuckWord =
        matchedCount > 0 || (draft.window[1]?.matched ?? 0) > 0;
      const current = state.sentences[draft.pointer];
      const canAdvanceWithinSentence = current && curPos < current.length;

      if (stalledLongEnough && progressingPastStuckWord && canAdvanceWithinSentence) {
        // Advance past exactly one stuck word, then re-settle so normal advance
        // rules can fire if the sentence is now sufficiently matched.
        draft.window[0].pos = curPos + 1;
        settle(state.sentences, state.skippable, draft, events, chunk.isFinal);
        posStalledSinceMs = null;
        stalledAtPos = null;
      }
    }

    // Update stall tracking for next chunk: reset when pos changed, else keep
    // the run going (recording its start time).
    const newPos = draft.window[0]?.pos ?? 0;
    if (!pointerUnchanged || stalledAtPos !== newPos) {
      stalledAtPos = newPos;
      posStalledSinceMs = chunk.tMs;
    }
  } else {
    posStalledSinceMs = null;
    stalledAtPos = null;
  }

  return {
    state: {
      ...state,
      pointer: draft.pointer,
      states: draft.states,
      window: draft.window,
      buffer,
      mismatchSinceMs: null,
      pendingUtterance: [],
      posStalledSinceMs,
      stalledAtPos,
    },
    events,
  };
}
