/**
 * Legacy bare-slug adoption on load.
 * Feature: reader-workspace
 *
 * Article ids were scoped by source on 2026-07-12 (`Human history` →
 * `wikipedia:Human history`); annotations made before that are keyed by the
 * bare slug. When a scoped doc has NO record in either store, loadAnnotations
 * must inherit the bare-slug set instead of silently showing an empty reader
 * (the "219 Human history annotations vanished" incident).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveAnnotations, loadAnnotations } from '../annotation-store';
import type { Annotation } from '../types';

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

function ann(docId: string, comment: string): Annotation {
  const ts = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    docId,
    startSentenceIndex: 3,
    endSentenceIndex: 4,
    selectedText: 'some passage',
    comment,
    aiReplies: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

describe('annotation-store — legacy bare-slug adoption', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it('a scoped id with no record inherits the bare-slug annotations, re-keyed', async () => {
    saveAnnotations('Human history', [ann('Human history', 'old note')]);

    const loaded = await loadAnnotations('wikipedia:Human history');

    expect(loaded).toHaveLength(1);
    expect(loaded[0].comment).toBe('old note');
    expect(loaded[0].docId).toBe('wikipedia:Human history');
  });

  it('adoption persists under the scoped id and leaves the legacy record intact', async () => {
    saveAnnotations('Human history', [ann('Human history', 'old note')]);

    await loadAnnotations('wikipedia:Human history');

    const scopedRaw = window.localStorage.getItem('reader-annotations:wikipedia:Human history');
    expect(scopedRaw).not.toBeNull();
    expect(JSON.parse(scopedRaw!).annotations).toHaveLength(1);
    const legacy = await loadAnnotations('Human history');
    expect(legacy).toHaveLength(1);
  });

  it('an explicitly emptied scoped doc does NOT resurrect legacy annotations', async () => {
    saveAnnotations('Human history', [ann('Human history', 'old note')]);
    saveAnnotations('wikipedia:Human history', []); // user deleted everything

    const loaded = await loadAnnotations('wikipedia:Human history');

    expect(loaded).toHaveLength(0);
  });

  it('an existing scoped record wins over the legacy set', async () => {
    saveAnnotations('Human history', [ann('Human history', 'old note')]);
    saveAnnotations('wikipedia:Human history', [ann('wikipedia:Human history', 'new note')]);

    const loaded = await loadAnnotations('wikipedia:Human history');

    expect(loaded).toHaveLength(1);
    expect(loaded[0].comment).toBe('new note');
  });

  it('a missing unscoped id stays empty (no adoption attempted)', async () => {
    await expect(loadAnnotations('Human history')).resolves.toHaveLength(0);
  });

  it('sep and iep scoped ids also adopt their bare slug', async () => {
    saveAnnotations('Baruch Spinoza', [ann('Baruch Spinoza', 'sep-era note')]);

    const loaded = await loadAnnotations('sep:Baruch Spinoza');

    expect(loaded).toHaveLength(1);
    expect(loaded[0].docId).toBe('sep:Baruch Spinoza');
  });
});
