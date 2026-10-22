/**
 * Integration tests for the Obsidian Book_Note sync wrapper (mocked fetch).
 * Feature: reader-workspace
 *
 * Covers: one POST per page with stable per-page titles, failure handling
 * (ok=false, page count not advanced), multi-page sync, and stale trailing
 * page cleanup when the page count shrinks.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { syncBookNote } from '../obsidian-sync';
import { loadLastWrittenPageCount } from '../annotation-store';
import type { Annotation } from '../types';

function installLocalStorageMock(): void {
  const backing = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
      clear: () => backing.clear(),
      key: (i: number) => Array.from(backing.keys())[i] ?? null,
      get length() {
        return backing.size;
      },
    },
  });
}

function annotation(id: string, comment: string): Annotation {
  return {
    id,
    docId: 'doc',
    startSentenceIndex: 0,
    endSentenceIndex: 0,
    selectedText: 'passage',
    comment,
    aiReplies: [],
    createdAt: 't',
    updatedAt: 't',
  };
}

/** Build a comment long enough to force multiple pages when repeated. */
function bigComment(n: number): string {
  return 'X'.repeat(n);
}

// One comment per page: each exceeds half the per-note limit (100,000 chars),
// so any two can't share a page.
const PAGE_FORCING = 60_000;

/**
 * Stub `fetch`, recording page POSTs (by task body) and stale-page DELETEs (by
 * title parsed from the query) separately. The sync writes pages via POST and
 * sweeps stale trailing pages via bodyless DELETE, so the mock must handle both.
 */
function stubRecordingFetch(): { posts: string[]; deletes: string[] } {
  const posts: string[] = [];
  const deletes: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (init?.method === 'DELETE') {
        const q = url.split('title=')[1] ?? '';
        deletes.push(decodeURIComponent(q));
        return { ok: true } as Response;
      }
      const body = JSON.parse(init.body as string) as { task: string };
      posts.push(body.task);
      return { ok: true } as Response;
    }),
  );
  return { posts, deletes };
}

describe('obsidian-sync — syncBookNote', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('posts one request per page; first line of each task is its stable title', async () => {
    const { posts } = stubRecordingFetch();

    const result = await syncBookNote('doc', 'My Book', [
      annotation('a', 'first comment'),
    ]);

    expect(result.ok).toBe(true);
    expect(result.pageCount).toBe(1);
    expect(posts).toHaveLength(1);
    // Folder-qualified, prefix-free title → lands in reading/annotations.
    expect(posts[0].split('\n')[0]).toBe('reading/annotations/My Book');
  });

  it('a non-200 on any page yields ok=false and does not advance the page count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }) as Response),
    );

    const result = await syncBookNote('doc', 'My Book', [annotation('a', 'c')]);
    expect(result.ok).toBe(false);
    // Page count remains 0 (not recorded on failure).
    expect(loadLastWrittenPageCount('doc')).toBe(0);
  });

  it('paginates a large annotation set into multiple sequentially-titled pages', async () => {
    const { posts } = stubRecordingFetch();

    // Four oversized comments force multiple pages (limit is 100,000 chars/page).
    const annotations = [
      annotation('a', bigComment(PAGE_FORCING)),
      annotation('b', bigComment(PAGE_FORCING)),
      annotation('c', bigComment(PAGE_FORCING)),
      annotation('d', bigComment(PAGE_FORCING)),
    ];
    const result = await syncBookNote('doc', 'Big Book', annotations);

    expect(result.ok).toBe(true);
    expect(result.pageCount).toBeGreaterThan(1);
    expect(posts).toHaveLength(result.pageCount);
    // First page uses the unsuffixed title; page 2 uses the (2) suffix.
    expect(posts[0].split('\n')[0]).toBe('reading/annotations/Big Book');
    expect(posts[1].split('\n')[0]).toBe('reading/annotations/Big Book (2)');
    expect(loadLastWrittenPageCount('doc')).toBe(result.pageCount);
  });

  it('refuses to overwrite a previously non-empty note with an empty set (wipe guard)', async () => {
    // First sync writes real content and records the annotation count.
    const first = stubRecordingFetch();
    await syncBookNote('doc', 'Guarded', [annotation('a', 'keep me')]);
    expect(first.posts).toHaveLength(1);

    // A later empty-set sync (annotations not loaded yet) must be a no-op.
    const second = stubRecordingFetch();
    const res = await syncBookNote('doc', 'Guarded', []);
    expect(res.skipped).toBe(true);
    expect(res.ok).toBe(true);
    expect(second.posts).toHaveLength(0);
  });

  it('allowEmpty permits an empty-set sync (explicit delete of the last annotation)', async () => {
    const first = stubRecordingFetch();
    await syncBookNote('doc', 'Guarded', [annotation('a', 'to delete')]);
    expect(first.posts).toHaveLength(1);

    const second = stubRecordingFetch();
    const res = await syncBookNote('doc', 'Guarded', [], { allowEmpty: true });
    expect(res.skipped).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(second.posts).toHaveLength(1); // banner-only page IS written

    // And with the count now recorded as 0, further empty syncs pass the guard.
    const third = stubRecordingFetch();
    const res2 = await syncBookNote('doc', 'Guarded', []);
    expect(res2.skipped).toBeUndefined();
    expect(third.posts).toHaveLength(1);
  });

  it('deletes stale trailing pages when the page count shrinks', async () => {
    // First sync: 3 pages (one oversized comment per page).
    const firstRun = stubRecordingFetch();
    const big = [
      annotation('a', bigComment(PAGE_FORCING)),
      annotation('b', bigComment(PAGE_FORCING)),
      annotation('c', bigComment(PAGE_FORCING)),
    ];
    const first = await syncBookNote('doc', 'Shrink', big);
    expect(first.pageCount).toBeGreaterThanOrEqual(2);
    expect(firstRun.posts).toHaveLength(first.pageCount);
    const firstCount = first.pageCount;

    // Second sync: a single tiny annotation → 1 page; the previously-written
    // higher-numbered pages are DELETEd from the vault.
    const { posts, deletes } = stubRecordingFetch();
    const second = await syncBookNote('doc', 'Shrink', [annotation('a', 'tiny')]);

    expect(second.pageCount).toBe(1);
    expect(posts).toHaveLength(1);
    // Every stale page (2..firstCount) is swept by title.
    for (let p = 2; p <= firstCount; p++) {
      expect(deletes).toContain(`reading/annotations/Shrink (${p})`);
    }
    expect(loadLastWrittenPageCount('doc')).toBe(1);
  });
});
