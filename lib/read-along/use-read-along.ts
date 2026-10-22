/**
 * Read-along alignment engine — React hook (Phase 2).
 * Feature: read-along-alignment
 *
 * useReadAlongAlignment(sentences) owns the matcher state and the STT
 * controller, and exposes the reactive surface the UI needs:
 *   { pointer, states, mode, pendingQA, status, isSupported, start, stop }
 *
 * The hook is the ONLY place matcher + STT + React meet. The matcher stays
 * pure (lib/read-along/matcher.ts); the STT adapter stays browser-coupled but
 * logic-free (lib/read-along/web-speech-stt.ts). This hook is glue.
 *
 * Question handling: when the matcher emits a 'question' event, the hook
 * surfaces it as `pendingQA` (utterance + anchorIndex) and does NOT itself
 * call any chat API — routing the question to /api/chat and rendering the
 * answer is the UI's responsibility, kept out of the hook so the hook has no
 * network dependency and stays testable. Call `clearPendingQA()` once handled.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMatcher, step, seek } from './matcher';
import { createWebSpeechStt, isSupported as sttSupported } from './web-speech-stt';
import type { WebSpeechSttController, SttStatus } from './web-speech-stt';
import {
  restoreIfValid,
  saveSession,
  type AnchoredQA,
} from './session-store';
import type {
  MatcherEvent,
  MatcherState,
  SentenceState,
  TranscriptChunk,
} from './types';

export interface PendingQA {
  utterance: string;
  anchorIndex: number;
}

export interface UseReadAlongOptions {
  /**
   * Stable identifier for the document (e.g. doc title or file path). When
   * provided, progress is persisted to localStorage and restored on reopen.
   */
  docId?: string;
  /** Document title, passed to the chat API as context for questions. */
  docTitle?: string;
  /**
   * Indices that are headings (or otherwise not read aloud). These auto-skim
   * so the pointer never stalls on a heading the reader voices past.
   */
  headingIndices?: Set<number>;
}

export interface ReadAlongApi {
  /** Current sentence index (monotonically non-decreasing). */
  pointer: number;
  /** Per-sentence read states; same length as `sentences`. */
  states: SentenceState[];
  /** 'following' while on-script, 'question' while off-script. */
  mode: 'following' | 'question';
  /** Set when the matcher detects an off-script question; null otherwise. */
  pendingQA: PendingQA | null;
  /** Anchored Q&A history for this document. */
  qas: AnchoredQA[];
  /** Live STT status for UI affordances. */
  status: SttStatus;
  /** Whether Web Speech STT is available in this browser. */
  isSupported: boolean;
  /** Begin listening + aligning. */
  start: () => void;
  /** Stop listening. Alignment state is preserved. */
  stop: () => void;
  /** Acknowledge a handled question so the next one can surface. */
  clearPendingQA: () => void;
  /**
   * Route an off-script question to the main /api/chat (Claude/Gemini/Kimi +
   * tools), with the surrounding sentences as context. Returns the answer and
   * records it in the anchored Q&A history. Throws on network/API error.
   */
  askQuestion: (utterance: string, anchorIndex: number) => Promise<string>;
  /**
   * Feed a transcript chunk manually (test/local-whisper path). Normally the
   * Web Speech adapter calls this internally; exposed for non-browser STT.
   */
  pushChunk: (chunk: TranscriptChunk) => void;
  /** Latest interim transcript text from Web Speech, for the Transcript_Readout (Req 11). */
  liveTranscript: string;
  /** Next-expected token index within the current pointer sentence (window[0].pos);
   *  -1 when no sentence is active. Drives word-by-word highlighting (Req 12). */
  inSentencePos: number;
  /** Normalized token array of the current pointer sentence (sentences[pointer]);
   *  used to detect token-count vs rendered-word divergence (Req 12.4). */
  currentSentenceTokens: string[];
  /** Manually move the highlight to a specific sentence (a deliberate user
   * jump/skip — e.g. clicking a sentence). Sentences jumped over are marked
   * 'skimmed'; backward jumps are allowed.
   */
  seekTo: (index: number) => void;
  /** Skip the current sentence: move the highlight forward by one. */
  skip: () => void;
}

export function useReadAlongAlignment(
  sentences: string[],
  options: UseReadAlongOptions = {},
): ReadAlongApi {
  const { docId, docTitle, headingIndices } = options;

  // Build the matcher once per `sentences` identity. The matcher is immutable;
  // we keep the live value in a ref and mirror the reactive parts in state.
  const matcherRef = useRef<MatcherState>(createMatcher(sentences));
  const sttRef = useRef<WebSpeechSttController | null>(null);
  // Latest props mirrored into refs so the rebuild effect can read them without
  // depending on their (unstable) array/Set identities. A parent that passes an
  // inline `sentences` array or `new Set(...)` for headings would otherwise
  // re-run the rebuild effect on EVERY render and wipe live reading progress.
  const rawSentencesRef = useRef<string[]>(sentences);
  const headingIndicesRef = useRef<Set<number> | undefined>(headingIndices);
  rawSentencesRef.current = sentences;
  headingIndicesRef.current = headingIndices;

  const [pointer, setPointer] = useState(0);
  const [states, setStates] = useState<SentenceState[]>(matcherRef.current.states);
  const [mode, setMode] = useState<'following' | 'question'>('following');
  const [pendingQA, setPendingQA] = useState<PendingQA | null>(null);
  const [qas, setQas] = useState<AnchoredQA[]>([]);
  const [status, setStatus] = useState<SttStatus>('idle');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [inSentencePos, setInSentencePos] = useState<number>(
    matcherRef.current.window[0]?.pos ?? -1,
  );
  const [currentSentenceTokens, setCurrentSentenceTokens] = useState<string[]>(
    matcherRef.current.sentences[matcherRef.current.pointer] ?? [],
  );

  const isSupported = useMemo(() => sttSupported(), []);

  // Rebuild matcher when the document changes, restoring saved progress if the
  // stored session still matches this document's sentence count.
  useEffect(() => {
    const sents = rawSentencesRef.current;
    const skippable = sents.map((_, i) => headingIndicesRef.current?.has(i) ?? false);
    const fresh = createMatcher(sents, skippable);
    const restored = docId ? restoreIfValid(docId, sents.length) : null;
    if (restored) {
      fresh.pointer = restored.pointer;
      fresh.states = restored.states;
      // Re-seed window progress as fresh from the restored pointer; the matcher
      // only needs forward progress, and restored sentences are already 'read'.
    }
    matcherRef.current = fresh;
    setPointer(fresh.pointer);
    setStates(fresh.states);
    setMode('following');
    setPendingQA(null);
    setQas(restored?.qas ?? []);
    setLiveTranscript('');
    setInSentencePos(fresh.pointer < fresh.sentences.length ? (fresh.window[0]?.pos ?? -1) : -1);
    setCurrentSentenceTokens(fresh.sentences[fresh.pointer] ?? []);
    // Rebuild ONLY on document-identity change (docId) or a structural change in
    // sentence count — never on a new array/Set reference for the same document,
    // which would discard in-progress reading state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, sentences.length]);

  // Persist progress whenever pointer, states, or Q&As change.
  useEffect(() => {
    if (!docId) return;
    saveSession({
      docId,
      pointer,
      states,
      qas,
      sentenceCount: sentences.length,
    });
  }, [docId, pointer, states, qas, sentences.length]);

  const applyEvents = useCallback((events: MatcherEvent[]) => {
    for (const event of events) {
      if (event.type === 'question') {
        setPendingQA({ utterance: event.utterance, anchorIndex: event.anchorIndex });
      }
      // 'advance' / 'skim' / 'resume' are already reflected in matcher state;
      // the snapshot sync below picks them up.
    }
  }, []);

  /** Mirror the matcher's word-level snapshot (Req 12) into reactive state. */
  const syncWordSnapshot = useCallback((s: typeof matcherRef.current) => {
    setInSentencePos(s.pointer < s.sentences.length ? (s.window[0]?.pos ?? -1) : -1);
    setCurrentSentenceTokens(s.sentences[s.pointer] ?? []);
  }, []);

  const pushChunk = useCallback(
    (chunk: TranscriptChunk) => {
      const { state, events } = step(matcherRef.current, chunk);
      matcherRef.current = state;
      // Sync reactive snapshot from the authoritative matcher state.
      setPointer(state.pointer);
      setStates(state.states);
      setMode(state.mode);
      syncWordSnapshot(state);
      if (events.length > 0) applyEvents(events);
    },
    [applyEvents, syncWordSnapshot],
  );

  const start = useCallback(() => {
    if (!isSupported) return;
    if (!sttRef.current) {
      sttRef.current = createWebSpeechStt({
        onChunk: pushChunk,
        onStatus: setStatus,
        onError: () => {
          /* surfaced via status; detailed handling is UI's concern */
        },
        onInterim: (text) => setLiveTranscript(text),
      });
    }
    sttRef.current?.start();
  }, [isSupported, pushChunk]);

  const stop = useCallback(() => {
    sttRef.current?.stop();
    setLiveTranscript('');
  }, []);

  const clearPendingQA = useCallback(() => setPendingQA(null), []);

  const seekTo = useCallback((index: number) => {
    const next = seek(matcherRef.current, index);
    matcherRef.current = next;
    setPointer(next.pointer);
    setStates(next.states);
    setMode(next.mode);
    setPendingQA(null);
    setInSentencePos(next.pointer < next.sentences.length ? (next.window[0]?.pos ?? -1) : -1);
    setCurrentSentenceTokens(next.sentences[next.pointer] ?? []);
  }, []);

  const skip = useCallback(() => {
    seekTo(matcherRef.current.pointer + 1);
  }, [seekTo]);

  const askQuestion = useCallback(
    async (utterance: string, anchorIndex: number): Promise<string> => {
      const raw = rawSentencesRef.current;
      // Context window: the sentence before, at, and after the anchor.
      const before = raw[anchorIndex - 1] ?? '';
      const at = raw[anchorIndex] ?? '';
      const after = raw[anchorIndex + 1] ?? '';
      const context = [before, at, after].filter(Boolean).join(' ');

      const message =
        `While reading${docTitle ? ` "${docTitle}"` : ''} (around sentence ` +
        `${anchorIndex + 1}), I asked aloud: "${utterance}"\n\n` +
        `The surrounding text is:\n"${context}"\n\n` +
        `Answer my question in that context.`;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, model: 'kimi' }),
      });
      if (!res.ok) {
        throw new Error(`Chat API error: ${res.status}`);
      }
      const data = (await res.json()) as { response?: string };
      const answer = data.response ?? '';

      setQas((prev) => [
        ...prev,
        { anchorIndex, question: utterance, answer, at: new Date().toISOString() },
      ]);
      return answer;
    },
    [docTitle],
  );

  // Stop recognition on unmount.
  useEffect(() => {
    return () => {
      sttRef.current?.stop();
    };
  }, []);

  return {
    pointer,
    states,
    mode,
    pendingQA,
    qas,
    status,
    isSupported,
    start,
    stop,
    clearPendingQA,
    askQuestion,
    pushChunk,
    liveTranscript,
    inSentencePos,
    currentSentenceTokens,
    seekTo,
    skip,
  };
}
