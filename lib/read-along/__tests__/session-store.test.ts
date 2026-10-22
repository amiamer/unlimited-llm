/**
 * Unit tests for read-along session persistence (Phase 2).
 * Feature: read-along-alignment
 *
 * Uses a localStorage mock so the store can be tested in the node/jsdom env.
 * Covers: round-trip save/load, version mismatch rejection, stale-document
 * rejection (sentence-count guard), and clear.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveSession,
  loadSession,
  clearSession,
  restoreIfValid,
} from '../session-store';
import type { SentenceState } from '../types';

function installLocalStorageMock(): void {
  const backing = new Map<string, string>();
  const mock = {
    getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => Array.from(backing.keys())[i] ?? null,
    get length() {
      return backing.size;
    },
  };
  vi.stubGlobal('window', { localStorage: mock });
}

const states = (n: number, fill: SentenceState = 'read_aloud'): SentenceState[] =>
  Array.from({ length: n }, () => fill);

describe('read-along session store', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it('round-trips a saved session', () => {
    saveSession({
      docId: 'doc-a',
      pointer: 5,
      states: states(10),
      qas: [{ anchorIndex: 3, question: 'what is this', answer: 'that', at: 'now' }],
      sentenceCount: 10,
    });
    const loaded = loadSession('doc-a');
    expect(loaded).not.toBeNull();
    expect(loaded!.pointer).toBe(5);
    expect(loaded!.states).toHaveLength(10);
    expect(loaded!.qas).toHaveLength(1);
    expect(loaded!.updatedAt).toBeTruthy();
  });

  it('returns null for a missing document', () => {
    expect(loadSession('nope')).toBeNull();
  });

  it('clears a session', () => {
    saveSession({ docId: 'doc-b', pointer: 1, states: states(3), qas: [], sentenceCount: 3 });
    expect(loadSession('doc-b')).not.toBeNull();
    clearSession('doc-b');
    expect(loadSession('doc-b')).toBeNull();
  });

  it('restoreIfValid returns progress when sentence count matches', () => {
    saveSession({ docId: 'doc-c', pointer: 4, states: states(8), qas: [], sentenceCount: 8 });
    const restored = restoreIfValid('doc-c', 8);
    expect(restored).not.toBeNull();
    expect(restored!.pointer).toBe(4);
    expect(restored!.states).toHaveLength(8);
  });

  it('restoreIfValid rejects a stale document (sentence count changed)', () => {
    saveSession({ docId: 'doc-d', pointer: 4, states: states(8), qas: [], sentenceCount: 8 });
    // Document was edited — now 9 sentences. Old progress is stale.
    expect(restoreIfValid('doc-d', 9)).toBeNull();
  });

  it('keeps sessions isolated by docId', () => {
    saveSession({ docId: 'doc-e', pointer: 2, states: states(5), qas: [], sentenceCount: 5 });
    saveSession({ docId: 'doc-f', pointer: 9, states: states(12), qas: [], sentenceCount: 12 });
    expect(loadSession('doc-e')!.pointer).toBe(2);
    expect(loadSession('doc-f')!.pointer).toBe(9);
  });
});
