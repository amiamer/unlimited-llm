/**
 * Client ↔ server file-store sync in the annotation store.
 * Feature: reader-workspace
 *
 * A server annotation file is the durable source of truth: loads prefer it and
 * heal the browser cache to match (including shrinking — deletions propagate);
 * when the server has no record, the local set migrates up; saves write
 * through; server outages degrade to pure browser behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveAnnotations,
  loadAnnotations,
  clearAnnotations,
  migrateLocalAnnotationsToServer,
} from '../annotation-store';
import type { Annotation } from '../types';

type FetchMock = ReturnType<typeof vi.fn>;

function installWindowMock(fetchImpl?: FetchMock): FetchMock {
  const backing = new Map<string, string>();
  const localStorageMock = {
    getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: (i: number) => Array.from(backing.keys())[i] ?? null,
    get length() {
      return backing.size;
    },
  };
  const fetchMock = fetchImpl ?? vi.fn();
  vi.stubGlobal('window', { localStorage: localStorageMock, fetch: fetchMock });
  return fetchMock;
}

function jsonResponse(payload: unknown): { ok: true; json: () => Promise<unknown> } {
  return { ok: true, json: async () => payload };
}

function ann(docId: string, comment: string): Annotation {
  const ts = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    docId,
    startSentenceIndex: 0,
    endSentenceIndex: 1,
    selectedText: 'passage',
    comment,
    aiReplies: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

function record(docId: string, annotations: Annotation[]) {
  return { version: 1, docId, annotations, updatedAt: new Date().toISOString() };
}

/** Calls to POST /api/annotations, parsed. */
function postedBodies(fetchMock: FetchMock): Array<{ docId: string; annotations: Annotation[]; allowEmpty: boolean }> {
  return fetchMock.mock.calls
    .filter(([url, init]) => url === '/api/annotations' && init?.method === 'POST')
    .map(([, init]) => JSON.parse(init.body));
}

describe('annotation-store — server file-store sync', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('load prefers the server record and heals localStorage to match (even shrinking)', async () => {
    const docId = 'wikipedia:Doc';
    const serverSet = [ann(docId, 'server truth')];
    const fetchMock = installWindowMock(
      vi.fn(async (url: string) =>
        url.startsWith('/api/annotations?docId=')
          ? jsonResponse({ record: record(docId, serverSet) })
          : jsonResponse({ ok: true }),
      ) as FetchMock,
    );
    // Stale, RICHER localStorage copy — must NOT win over the server file.
    window.localStorage.setItem(
      `reader-annotations:${docId}`,
      JSON.stringify(record(docId, [ann(docId, 'stale 1'), ann(docId, 'stale 2')])),
    );

    const loaded = await loadAnnotations(docId);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].comment).toBe('server truth');
    const healed = JSON.parse(window.localStorage.getItem(`reader-annotations:${docId}`)!);
    expect(healed.annotations).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('load with no server record returns the local set and migrates it up', async () => {
    const docId = 'wikipedia:Doc';
    const fetchMock = installWindowMock(
      vi.fn(async () => jsonResponse({ record: null })) as FetchMock,
    );
    window.localStorage.setItem(
      `reader-annotations:${docId}`,
      JSON.stringify(record(docId, [ann(docId, 'local note')])),
    );

    const loaded = await loadAnnotations(docId);

    expect(loaded).toHaveLength(1);
    const posts = postedBodies(fetchMock);
    expect(posts).toHaveLength(1);
    expect(posts[0].docId).toBe(docId);
    expect(posts[0].annotations).toHaveLength(1);
  });

  it('server outage degrades to browser storage without migration posts', async () => {
    const docId = 'wikipedia:Doc';
    const fetchMock = installWindowMock(
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as FetchMock,
    );
    window.localStorage.setItem(
      `reader-annotations:${docId}`,
      JSON.stringify(record(docId, [ann(docId, 'local note')])),
    );

    const loaded = await loadAnnotations(docId);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].comment).toBe('local note');
    expect(postedBodies(fetchMock)).toHaveLength(0);
  });

  it('save writes through to the server, carrying allowEmpty', async () => {
    const docId = 'wikipedia:Doc';
    const fetchMock = installWindowMock(vi.fn(async () => jsonResponse({ ok: true })) as FetchMock);

    saveAnnotations(docId, [ann(docId, 'note')]);
    saveAnnotations(docId, [], { allowEmpty: true });

    const posts = postedBodies(fetchMock);
    expect(posts).toHaveLength(2);
    expect(posts[0].allowEmpty).toBe(false);
    expect(posts[1].allowEmpty).toBe(true);
    expect(posts[1].annotations).toHaveLength(0);
  });

  it('clearAnnotations posts an explicit empty set (allowEmpty)', async () => {
    const docId = 'wikipedia:Doc';
    const fetchMock = installWindowMock(vi.fn(async () => jsonResponse({ ok: true })) as FetchMock);

    clearAnnotations(docId);

    const posts = postedBodies(fetchMock);
    expect(posts).toHaveLength(1);
    expect(posts[0].annotations).toHaveLength(0);
    expect(posts[0].allowEmpty).toBe(true);
  });

  it('migration sweep pushes docs the server lacks and skips ones it has', async () => {
    const fetchMock = installWindowMock(
      vi.fn(async (url: string) =>
        url === '/api/annotations?index=1'
          ? jsonResponse({ index: [{ docId: 'already-there', count: 3, updatedAt: 'x' }] })
          : jsonResponse({ ok: true }),
      ) as FetchMock,
    );
    window.localStorage.setItem(
      'reader-annotations:already-there',
      JSON.stringify(record('already-there', [ann('already-there', 'a')])),
    );
    window.localStorage.setItem(
      'reader-annotations:new-doc',
      JSON.stringify(record('new-doc', [ann('new-doc', 'b')])),
    );
    window.localStorage.setItem(
      'reader-annotations:empty-doc',
      JSON.stringify(record('empty-doc', [])),
    );

    await migrateLocalAnnotationsToServer();
    await new Promise((r) => setTimeout(r, 0)); // let fire-and-forget posts run

    const posts = postedBodies(fetchMock);
    expect(posts).toHaveLength(1);
    expect(posts[0].docId).toBe('new-doc');
  });

  it('without window.fetch (test env / SSR) everything degrades silently', async () => {
    installWindowMock();
    // Remove fetch from the stubbed window entirely.
    vi.stubGlobal('window', { localStorage: (window as unknown as { localStorage: Storage }).localStorage });
    const docId = 'doc';
    saveAnnotations(docId, [ann(docId, 'note')]);
    await expect(loadAnnotations(docId)).resolves.toHaveLength(1);
  });
});
