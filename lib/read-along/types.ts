/**
 * Read-along alignment engine — shared types.
 * Feature: read-along-alignment (Phase 1: pure matcher — no STT, no UI, no React)
 *
 * The matcher is a pure module: timestamps are injected by the caller via
 * TranscriptChunk.tMs. The matcher never reads the wall clock, so it stays
 * deterministic and testable.
 */

export type SentenceState = 'unread' | 'skimmed' | 'read_aloud';

export type MatcherMode = 'following' | 'question';

export interface TranscriptChunk {
  /**
   * Raw transcript text for this chunk. Chunks are deltas (new speech only),
   * not cumulative re-transcriptions — the Phase 2 STT adapter is responsible
   * for converting cumulative interim results into deltas.
   */
  text: string;
  /**
   * Utterance-final flag from the STT layer. An isFinal chunk lets the matcher
   * finalize a sentence that is ≥70% consumed but whose tail tokens were
   * garbled (e.g. the last word was misheard).
   */
  isFinal: boolean;
  /** Caller-injected timestamp in ms. Must be non-decreasing across chunks. */
  tMs: number;
}

export type MatcherEvent =
  | { type: 'advance'; index: number }
  | { type: 'skim'; index: number } // sentence jumped over
  | { type: 'question'; utterance: string; anchorIndex: number }
  | { type: 'resume' };

/** In-order match progress against one sentence of the active window. */
export interface WindowProgress {
  /** How many of the sentence's tokens have been matched in order so far. */
  matched: number;
  /** Index into the sentence's token array: the next expected position. */
  pos: number;
}

export interface MatcherState {
  /** Pre-normalized token arrays, one per sentence. Never mutated. */
  sentences: string[][];
  /**
   * Per-sentence "skippable" flags (e.g. headings). A skippable sentence the
   * reader doesn't voice is auto-skimmed once a later sentence starts matching,
   * so the pointer never stalls on a heading nobody reads aloud.
   */
  skippable: boolean[];
  /** Current sentence index. Monotonically non-decreasing. */
  pointer: number;
  /** Per-sentence read states. Same length as `sentences`, always. */
  states: SentenceState[];
  /** Rolling normalized transcript buffer (last ~12 tokens). */
  buffer: string[];
  mode: MatcherMode;
  /** Match progress for sentences pointer, pointer+1, pointer+2. */
  window: WindowProgress[];
  /**
   * tMs of the first low-similarity chunk in the current mismatch run,
   * or null when there is no active run. Drives question-mode detection.
   */
  mismatchSinceMs: number | null;
  /** Raw text of accumulated unmatched chunks — the candidate question utterance. */
  pendingUtterance: string[];
  /**
   * tMs when the current in-sentence position (window[0].pos) last changed —
   * the start of the current stall run — or null when it just advanced.
   * Drives single-word stumble auto-advance (Req 13).
   */
  posStalledSinceMs: number | null;
  /** The window[0].pos value observed at posStalledSinceMs, to detect "no advance". */
  stalledAtPos: number | null;
}
