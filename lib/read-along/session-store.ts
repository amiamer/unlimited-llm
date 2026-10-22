/**
 * Read-along alignment engine — session persistence (Phase 2).
 * Feature: read-along-alignment
 *
 * Persists per-document read-along progress to browser localStorage, matching
 * the existing reader-session storage pattern (the reader already persists epub
 * sessions in localStorage). One record per document, keyed by a stable docId.
 *
 * Stored: pointer, per-sentence states, anchored Q&As, and timestamps. On
 * reopen the UI restores the pointer and states so the reader resumes where
 * they stopped.
 *
 * Pure/string-keyed: all functions are no-ops (or return null) when window is
 * undefined, so importing this on the server is safe.
 */

import type { SentenceState } from './types';

const STORAGE_PREFIX = 'read-along-session:';
const STORAGE_VERSION = 1;

export interface AnchoredQA {
  /** Sentence index this exchange is anchored to. */
  anchorIndex: number;
  /** What the reader said/asked off-script. */
  question: string;
  /** The assistant's answer (may be empty if not yet answered). */
  answer: string;
  /** ISO timestamp. */
  at: string;
}

export interface ReadAlongSession {
  version: number;
  docId: string;
  pointer: number;
  states: SentenceState[];
  qas: AnchoredQA[];
  /** Total sentence count at save time — guards against doc edits. */
  sentenceCount: number;
  updatedAt: string;
}

function keyFor(docId: string): string {
  return `${STORAGE_PREFIX}${docId}`;
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function loadSession(docId: string): ReadAlongSession | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(docId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReadAlongSession;
    if (parsed.version !== STORAGE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: Omit<ReadAlongSession, 'version' | 'updatedAt'>): void {
  if (!hasStorage()) return;
  try {
    const record: ReadAlongSession = {
      ...session,
      version: STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(keyFor(session.docId), JSON.stringify(record));
  } catch {
    // Quota or serialization failure — non-fatal; progress just won't persist.
  }
}

export function clearSession(docId: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(keyFor(docId));
  } catch {
    /* non-fatal */
  }
}

/**
 * Restore pointer + states for a document, but ONLY if the stored session
 * matches the current sentence count. If the document changed (different
 * length), the old progress is stale and we start fresh.
 */
export function restoreIfValid(
  docId: string,
  currentSentenceCount: number,
): { pointer: number; states: SentenceState[]; qas: AnchoredQA[] } | null {
  const session = loadSession(docId);
  if (!session) return null;
  if (session.sentenceCount !== currentSentenceCount) return null;
  if (session.states.length !== currentSentenceCount) return null;
  return { pointer: session.pointer, states: session.states, qas: session.qas };
}
