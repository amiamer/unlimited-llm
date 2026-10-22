/**
 * Read-along alignment engine — Web Speech API STT adapter (Phase 2).
 * Feature: read-along-alignment
 *
 * Wraps the browser's `webkitSpeechRecognition` (continuous + interim) and
 * converts its CUMULATIVE interim transcripts into the DELTA TranscriptChunks
 * the matcher expects. The matcher consumes new speech only, never re-feeds
 * already-matched tokens — so this adapter is responsible for diffing.
 *
 * The adapter owns no matching logic and no wall clock beyond stamping each
 * chunk with Date.now() at emission time. It is the only browser-coupled part
 * of the pipeline; everything downstream (the matcher) stays pure.
 *
 * v1 scope: Chrome only (webkitSpeechRecognition). If the API is unavailable,
 * `isSupported()` returns false and the caller falls back (e.g. local whisper
 * server in a later phase).
 */

import type { TranscriptChunk } from './types';

export type SttStatus = 'idle' | 'listening' | 'error';

export interface WebSpeechSttOptions {
  /** BCP-47 language tag. Defaults to 'en-US'. */
  lang?: string;
  /** Called with each delta chunk (new speech only). */
  onChunk: (chunk: TranscriptChunk) => void;
  /** Called on status transitions, for UI. */
  onStatus?: (status: SttStatus) => void;
  /** Called on recognition errors with the raw error code. */
  onError?: (code: string) => void;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
  /**
   * Latest cumulative interim transcript for the current result (Req 11).
   * Fired on every `onresult` with the recognizer's current best text, before
   * diffing into delta chunks. Purely informational — does not affect matching.
   */
  onInterim?: (text: string, isFinal: boolean) => void;
}

/**
 * Minimal structural types for the Web Speech API. The DOM lib does not ship
 * `webkitSpeechRecognition` types, so we declare the surface we use.
 */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternativeLike;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  readonly length: number;
  item(index: number): SpeechRecognitionResultLike;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    webkitSpeechRecognition?: SpeechRecognitionCtor;
    SpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSupported(): boolean {
  return getRecognitionCtor() !== null;
}

/**
 * Compute the delta between a previous cumulative string and the current one.
 * Web Speech keeps revising the tail of the current (non-final) utterance, so
 * we cannot assume pure append. Strategy: if `current` starts with `previous`,
 * the delta is the appended suffix; otherwise the tail was revised, so we emit
 * the portion past the longest common prefix. Exported for unit testing.
 */
export function diffCumulative(previous: string, current: string): string {
  if (current === previous) return '';
  if (previous.length === 0) return current;
  if (current.startsWith(previous)) {
    return current.slice(previous.length);
  }
  // Tail revision: find the longest common prefix, emit the remainder.
  let i = 0;
  const max = Math.min(previous.length, current.length);
  while (i < max && previous[i] === current[i]) i++;
  return current.slice(i);
}

export interface WebSpeechSttController {
  start(): void;
  stop(): void;
}

/**
 * Create a Web Speech STT controller. Returns null if the API is unsupported,
 * so the caller can branch on availability.
 */
export function createWebSpeechStt(
  options: WebSpeechSttOptions,
): WebSpeechSttController | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;

  const now = options.now ?? Date.now;
  const recognition = new Ctor();
  recognition.lang = options.lang ?? 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;

  // Per-result cumulative text, so we can diff each result independently.
  // Web Speech revises the current interim result in place and bumps
  // resultIndex when a result finalizes.
  let lastCumulativeByResult: string[] = [];
  let running = false;

  recognition.onresult = (event: SpeechRecognitionEventLike) => {
    const results = event.results;
    for (let r = event.resultIndex; r < results.length; r++) {
      const result = results[r];
      const text = result[0]?.transcript ?? '';
      // Surface the cumulative interim text for the Live_Transcript (Req 11),
      // before diffing — purely informational, does not affect matching.
      options.onInterim?.(text, result.isFinal);
      const previous = lastCumulativeByResult[r] ?? '';
      const delta = diffCumulative(previous, text);
      lastCumulativeByResult[r] = text;
      if (delta.trim().length > 0) {
        options.onChunk({ text: delta, isFinal: result.isFinal, tMs: now() });
      }
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
    // 'no-speech' and 'aborted' are benign; surface everything to the caller.
    options.onError?.(event.error);
    if (event.error !== 'no-speech') {
      options.onStatus?.('error');
    }
  };

  recognition.onend = () => {
    // Web Speech stops itself after silence; restart to stay continuous.
    if (running) {
      // A restarted session re-numbers its results from index 0, so the
      // cumulative-diff baselines from the previous session are stale. Clear
      // them before restarting — otherwise the first chunk after a pause gets
      // diffed against the old utterance and emits a corrupted delta.
      lastCumulativeByResult = [];
      try {
        recognition.start();
      } catch {
        // start() throws if already started; ignore.
      }
    } else {
      options.onStatus?.('idle');
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastCumulativeByResult = [];
      try {
        recognition.start();
        options.onStatus?.('listening');
      } catch {
        // Already started — treat as listening.
        options.onStatus?.('listening');
      }
    },
    stop() {
      if (!running) return;
      running = false;
      recognition.stop();
    },
  };
}
