/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for the useAnnotationWorkspace hook (mocked network + storage).
 * Feature: reader-workspace
 *
 * Covers: commit/discard logic, edit, delete, AI reply append + error
 * retention, and the retry path. The DOM-selection path (beginSelection) is
 * exercised at the component/integration level; here we drive the hook's
 * action surface directly.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAnnotationWorkspace } from '../use-annotation-workspace';

function installLocalStorageMock(): void {
  const backing = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
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

const baseOptions = () => ({
  docId: 'doc-1',
  docTitle: 'Test Book',
  sentenceCount: 100,
  sentences: ['s0', 's1', 's2', 's3', 's4'],
  onSelectionPauseReadAlong: vi.fn(),
});

/**
 * Flush the hook's async mount-load. Mutations and syncs are load-gated (they
 * queue until the doc's stored annotations have loaded), so tests must settle
 * the load before driving actions.
 */
async function flushLoad(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('useAnnotationWorkspace', () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ response: 'AI answer' }) }) as unknown as Response),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Seed a committed annotation by simulating a selection + commit. */
  function seedAnnotation(
    result: { current: ReturnType<typeof useAnnotationWorkspace> },
    container: HTMLElement,
    comment: string,
  ): void {
    // Build a real Range over the container's sentence spans.
    const range = document.createRange();
    range.selectNodeContents(container);
    act(() => {
      result.current.beginSelection(range, container);
    });
    act(() => {
      result.current.setPendingText(comment);
    });
    act(() => {
      result.current.commitPending();
    });
  }

  function makeContainer(): HTMLElement {
    const div = document.createElement('div');
    div.innerHTML =
      '<span data-sentence-index="0">Hello world.</span>' +
      '<span data-sentence-index="1">Second sentence.</span>';
    document.body.appendChild(div);
    return div;
  }

  it('commits a non-empty comment as an annotation; discards empty', async () => {
    const { result } = renderHook(() => useAnnotationWorkspace(baseOptions()));
    const container = makeContainer();
    await flushLoad();

    // Empty comment → discarded.
    const range = document.createRange();
    range.selectNodeContents(container);
    act(() => result.current.beginSelection(range, container));
    act(() => result.current.setPendingText('   '));
    act(() => result.current.commitPending());
    expect(result.current.annotations).toHaveLength(0);

    // Non-empty comment → committed.
    seedAnnotation(result, container, 'my note');
    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.annotations[0].comment).toBe('my note');
    expect(result.current.pendingPopover).toBeNull();
  });

  it('edits an annotation comment', async () => {
    const { result } = renderHook(() => useAnnotationWorkspace(baseOptions()));
    const container = makeContainer();
    await flushLoad();
    seedAnnotation(result, container, 'original');
    const id = result.current.annotations[0].id;

    act(() => result.current.editAnnotation(id, 'edited'));
    expect(result.current.annotations[0].comment).toBe('edited');
  });

  it('deletes an annotation', async () => {
    const { result } = renderHook(() => useAnnotationWorkspace(baseOptions()));
    const container = makeContainer();
    await flushLoad();
    seedAnnotation(result, container, 'to delete');
    const id = result.current.annotations[0].id;

    act(() => result.current.deleteAnnotation(id));
    expect(result.current.annotations).toHaveLength(0);
  });

  it('addWikiLink captures a wiki link as a link annotation, and dedups the same span', async () => {
    const { result } = renderHook(() => useAnnotationWorkspace(baseOptions()));
    const container = makeContainer();
    await flushLoad();

    // Capture the first sentence span as a wiki link.
    const anchorEl = container.querySelector('[data-sentence-index="0"]') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(anchorEl);
    act(() => result.current.addWikiLink(range, container, 'Hello World'));

    expect(result.current.annotations).toHaveLength(1);
    const a = result.current.annotations[0];
    expect(a.linkTarget).toBe('Hello World'); // link annotation, target from the wiki title
    expect(a.comment).toBe('');               // link-only, no comment
    // Does not pop the thread panel open (bulk-capture stays fast).
    expect(result.current.activeThreadId).toBeNull();

    // Clicking the same span again must not stack a duplicate.
    const range2 = document.createRange();
    range2.selectNodeContents(anchorEl);
    act(() => result.current.addWikiLink(range2, container, 'Hello World'));
    expect(result.current.annotations).toHaveLength(1);
  });

  it('addWikiLink reports a duplicate when the same term is already linked elsewhere', async () => {
    const { result } = renderHook(() => useAnnotationWorkspace(baseOptions()));
    const container = makeContainer();
    await flushLoad();
    const s0 = container.querySelector('[data-sentence-index="0"]') as HTMLElement;
    const s1 = container.querySelector('[data-sentence-index="1"]') as HTMLElement;

    // Link "Baruch Spinoza" on the first sentence.
    const r0 = document.createRange();
    r0.selectNodeContents(s0);
    let first: ReturnType<typeof result.current.addWikiLink> | undefined;
    act(() => { first = result.current.addWikiLink(r0, container, 'Baruch Spinoza'); });
    expect(first).toMatchObject({ status: 'added' });
    expect(result.current.annotations).toHaveLength(1);

    // Now try to link the SAME term (case/underscore-insensitive) on a DIFFERENT
    // sentence — it must not stack a duplicate, and it reports the existing one.
    const r1 = document.createRange();
    r1.selectNodeContents(s1);
    let second: ReturnType<typeof result.current.addWikiLink> | undefined;
    act(() => { second = result.current.addWikiLink(r1, container, 'baruch_spinoza'); });
    expect(second).toMatchObject({ status: 'duplicate', existingId: result.current.annotations[0].id });
    expect(result.current.annotations).toHaveLength(1); // no duplicate created
  });

  it('flags alreadyLinked on a selection whose term is linked elsewhere', async () => {
    const { result } = renderHook(() => useAnnotationWorkspace(baseOptions()));
    const container = makeContainer();
    await flushLoad();
    const s0 = container.querySelector('[data-sentence-index="0"]') as HTMLElement;
    const s1 = container.querySelector('[data-sentence-index="1"]') as HTMLElement;

    const r0 = document.createRange();
    r0.selectNodeContents(s0);
    act(() => { result.current.addWikiLink(r0, container, 'Hello World'); });

    // A drag-selection elsewhere whose term matches should surface alreadyLinked.
    const r1 = document.createRange();
    r1.selectNodeContents(s1);
    act(() => result.current.beginSelection(r1, container));
    // s1 text is "Second sentence." — not the linked term, so not alreadyLinked.
    expect(result.current.pendingPopover?.alreadyLinked).toBe(false);
    act(() => result.current.cancelPending());

    // Re-select s0 (its text IS the linked term) → alreadyLinked true.
    const r0b = document.createRange();
    r0b.selectNodeContents(s0);
    act(() => result.current.beginSelection(r0b, container));
    expect(result.current.pendingPopover?.alreadyLinked).toBe(true);
  });

  it('resyncNote fired BEFORE the doc load resolves syncs the stored set, not an empty one (Phronesis wipe regression)', async () => {
    // Seed a stored annotation for doc-1 (localStorage fallback path).
    const stored = {
      version: 1,
      docId: 'doc-1',
      annotations: [
        {
          id: 'seed-1',
          docId: 'doc-1',
          startSentenceIndex: 0,
          endSentenceIndex: 0,
          selectedText: 'passage',
          comment: 'my precious comment',
          aiReplies: [],
          createdAt: 't',
          updatedAt: 't',
        },
      ],
      updatedAt: 't',
    };
    window.localStorage.setItem('reader-annotations:doc-1', JSON.stringify(stored));

    const posts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && init.body) {
          posts.push((JSON.parse(init.body as string) as { task: string }).task);
        }
        return { ok: true } as Response;
      }),
    );

    const { result } = renderHook(() => useAnnotationWorkspace(baseOptions()));
    // Fire the summary-strip commit IMMEDIATELY — before the load settles.
    // This is exactly what wiped Reading: Phronesis mid-navigation.
    await act(async () => {
      await result.current.resyncNote();
    });
    await flushLoad();

    // Every synced page must carry the stored comment — never an empty banner.
    expect(posts.length).toBeGreaterThan(0);
    for (const task of posts) {
      expect(task).toContain('my precious comment');
    }
  });

  it('appends an AI reply on success', async () => {
    const { result } = renderHook(() => useAnnotationWorkspace(baseOptions()));
    const container = makeContainer();
    await flushLoad();
    seedAnnotation(result, container, 'explain this');
    const id = result.current.annotations[0].id;

    await act(async () => {
      await result.current.requestAiReply(id);
    });

    await waitFor(() =>
      expect(result.current.annotations[0].aiReplies).toHaveLength(1),
    );
    expect(result.current.annotations[0].aiReplies[0].content).toBe('AI answer');
    expect(result.current.aiStatus[id]).toBe('idle');
  });

  it('sets aiStatus=error and retains the comment when the AI request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }) as Response),
    );
    const { result } = renderHook(() => useAnnotationWorkspace(baseOptions()));
    const container = makeContainer();
    await flushLoad();
    seedAnnotation(result, container, 'keep me');
    const id = result.current.annotations[0].id;

    await act(async () => {
      await result.current.requestAiReply(id);
    });

    expect(result.current.aiStatus[id]).toBe('error');
    expect(result.current.annotations[0].aiReplies).toHaveLength(0);
    expect(result.current.annotations[0].comment).toBe('keep me');
  });

  it('marks syncStatus=error when Obsidian sync fails on commit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }) as Response),
    );
    const { result } = renderHook(() => useAnnotationWorkspace(baseOptions()));
    const container = makeContainer();
    await flushLoad();
    seedAnnotation(result, container, 'note');
    const id = result.current.annotations[0].id;

    await waitFor(() => expect(result.current.syncStatus[id]).toBe('error'));

    // Retry with a now-succeeding endpoint clears the error.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true }) as Response),
    );
    act(() => result.current.retrySync(id));
    await waitFor(() => expect(result.current.syncStatus[id]).toBe('idle'));
  });
});
