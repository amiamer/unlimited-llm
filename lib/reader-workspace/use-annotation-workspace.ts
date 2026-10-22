/**
 * Reader Workspace — annotation orchestration hook.
 * Feature: reader-workspace
 *
 * Concentrates the stateful annotation lifecycle (selection → popover → commit
 * → persist → AI reply → Obsidian sync → edit/delete) behind named actions, so
 * the reader page stays an orchestrator and the pure modules (anchor,
 * annotation-store, book-note) stay DOM-free and testable.
 *
 * Local persistence is the source of truth; the Obsidian sync and the AI reply
 * are best-effort layers on top, so a failed sync never loses an annotation
 * (Requirements 6.9, 8.9).
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AiReply,
  AiState,
  Annotation,
  PendingPopover,
  SyncState,
} from './types';
import { deriveAnchor } from './anchor';
import {
  loadAnnotations,
  saveAnnotations,
} from './annotation-store';
import { syncBookNote, type SyncOptions } from './obsidian-sync';

export interface UseAnnotationWorkspaceOptions {
  /** Document key — matches the read-along docId. Null when no doc is open. */
  docId: string | null;
  /** Document title, used for Book_Note titles and AI context. */
  docTitle: string | null;
  /** Current document sentence count, for stale-annotation filtering. */
  sentenceCount: number;
  /** Flat sentence array, for building AI surrounding-context windows. */
  sentences: string[];
  /** Called when a selection begins so the page can pause read-along (Req 1.10/2.8). */
  onSelectionPauseReadAlong: () => void;
}

export interface AnnotationWorkspaceApi {
  annotations: Annotation[];
  pendingPopover: PendingPopover | null;
  activeThreadId: string | null;
  syncStatus: Record<string, SyncState>;
  aiStatus: Record<string, AiState>;

  beginSelection(range: Range, container: HTMLElement): void;
  setPendingText(text: string): void;
  setPendingLink(enabled: boolean): void;
  setPendingLinkTarget(target: string): void;
  commitPending(): void;
  cancelPending(): void;
  /**
   * Create a standalone note — no highlighted passage, no selection needed.
   * Anchored to `sentenceIndex` so it sorts into the comment stream at the
   * reader's current position.
   */
  addNote(comment: string, sentenceIndex: number): void;
  /**
   * Capture a Wikipedia link as a link-annotation straight from its anchor
   * element (no selection/popover). Powers the reader's one-click "link mode".
   * Returns whether it was added or was a duplicate (already linked elsewhere),
   * so the caller can show "already linked" feedback.
   */
  addWikiLink(range: Range, container: HTMLElement, wikiTitle: string): AddWikiLinkResult;
  setActiveThread(id: string | null): void;
  editAnnotation(id: string, comment: string): void;
  editSelectedText(id: string, selectedText: string): void;
  /** Set the [[proper name]] a link points at (empty = use the selected text). */
  editLinkTarget(id: string, linkTarget: string): void;
  deleteAnnotation(id: string): void;
  requestAiReply(id: string, followUp?: string): Promise<void>;
  retrySync(id: string): void;
  /** Wait for this exact document to load and return a stable annotation snapshot. */
  getLoadedAnnotations(): Promise<Annotation[] | null>;
  /** Re-sync the Book_Note (e.g. after the running summary changed). */
  resyncNote(): Promise<boolean>;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Extract the linked article's title from a wiki anchor. The rendered article
 * stores the resolved title on `data-wiki` (hrefs are stripped at render time
 * so the browser can never navigate); older `/wiki/...` hrefs are still parsed
 * as a fallback.
 */
function wikiTitleFromAnchor(anchor: Element): string | null {
  const dataTitle = anchor.getAttribute('data-wiki');
  if (dataTitle) return dataTitle.trim() || null;
  const href = anchor.getAttribute('href') ?? '';
  if (!href.startsWith('/wiki/')) return null;
  const raw = href.slice('/wiki/'.length).split('#')[0].split('?')[0];
  if (!raw) return null;
  let title: string;
  try { title = decodeURIComponent(raw); } catch { title = raw; }
  return title.replace(/_/g, ' ').trim() || null;
}

const WIKI_ANCHOR_SELECTOR = 'a[data-wiki], a[href^="/wiki/"]';

/**
 * If the selection sits inside a Wikipedia anchor, OR covers exactly one wiki
 * anchor along with surrounding text, return the linked article's title so the
 * highlight becomes a real concept link (and the popover pre-fills the link
 * box). Returns null when the selection touches no wiki link, or spans several
 * (ambiguous — the reader picks a target manually).
 */
function wikiTitleFromRange(range: Range): string | null {
  let node: Node | null = range.commonAncestorContainer;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  const el = node as Element | null;
  if (!el) return null;

  // Selection inside a link.
  if (typeof el.closest === 'function') {
    const within = el.closest(WIKI_ANCHOR_SELECTOR);
    if (within) return wikiTitleFromAnchor(within);
  }

  // Selection containing a link (a linked term plus words around it).
  if (
    typeof el.querySelectorAll === 'function' &&
    typeof range.intersectsNode === 'function'
  ) {
    const touched = Array.from(el.querySelectorAll(WIKI_ANCHOR_SELECTOR)).filter((a) => {
      try {
        return range.intersectsNode(a);
      } catch {
        return false;
      }
    });
    if (touched.length === 1) return wikiTitleFromAnchor(touched[0]);
  }
  return null;
}

/**
 * Capitalize the first letter only (Wikipedia's title convention). Used as a
 * safety net when a link is made from plain (non-linked) text, so a stray
 * lowercase `mercantilism` is saved as `[[Mercantilism|mercantilism]]`.
 */
function capitalizeFirst(s: string): string {
  const t = (s ?? '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/**
 * Normalize a link term for duplicate detection: case-insensitive, whitespace-
 * and underscore-collapsed, punctuation-stripped. So "Baruch Spinoza",
 * "baruch_spinoza", and "baruch  spinoza" all compare equal.
 */
function linkKey(s: string): string {
  return (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/[<>:"/\\|?*[\]]/g, '')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '') // strip edge punctuation (trailing . , etc.)
    .trim();
}

/** The effective link term of an annotation (linkTarget, or the selected text). */
function annotationLinkTerm(a: Annotation): string {
  return (a.linkTarget?.trim() || a.selectedText || '').trim();
}

/**
 * Find an existing LINK annotation anywhere in the set whose term matches `key`
 * (already normalized). Used to catch a term that was linked earlier in the
 * article so we don't silently create a duplicate link.
 */
function findLinkByKey(annotations: Annotation[], key: string): Annotation | undefined {
  if (!key) return undefined;
  return annotations.find(
    (a) => a.linkTarget !== undefined && linkKey(annotationLinkTerm(a)) === key,
  );
}

/** Result of a link-mode capture — tells the caller whether to show feedback. */
export type AddWikiLinkResult =
  | { status: 'added'; id: string }
  | { status: 'duplicate'; existingId: string; term: string }
  | { status: 'noop' };

/**
 * Fetch an AI reply for an annotation. Uses GLM as the primary model and falls
 * back to Kimi if GLM errors or hangs, so a single flaky call doesn't leave the
 * note's AI request "failed". Each attempt has its own timeout so a stalled
 * request fails over instead of hanging forever.
 */
async function requestChatReply(message: string): Promise<string> {
  const attempt = async (model: string, timeoutMs: number): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // mode:'reader' → focused reading-companion prompt, no personal
        // memory/vault context (stops replies dragging in unrelated projects).
        body: JSON.stringify({ message, model, mode: 'reader' }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Chat API error: ${res.status}`);
      const data = (await res.json()) as { response?: string };
      return data.response ?? '';
    } finally {
      clearTimeout(timer);
    }
  };

  // Whole-chapter highlights need longer to read and summarize.
  const long = message.length > 20_000;
  try {
    return await attempt('glm', long ? 180_000 : 60_000);
  } catch (e) {
    console.warn('[reader-ai] GLM reply failed, falling back to Kimi:', e instanceof Error ? e.message : e);
    return await attempt('kimi', long ? 150_000 : 45_000);
  }
}

/** Above this, a highlight is sent without the surrounding paragraph. */
const LONG_PASSAGE_CHARS = 2_000;

export function useAnnotationWorkspace(
  options: UseAnnotationWorkspaceOptions,
): AnnotationWorkspaceApi {
  const { docId, docTitle, sentenceCount, sentences, onSelectionPauseReadAlong } =
    options;

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pendingPopover, setPendingPopover] = useState<PendingPopover | null>(null);
  const pendingPopoverRef = useRef<PendingPopover | null>(null);
  pendingPopoverRef.current = pendingPopover;
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<Record<string, SyncState>>({});
  const [aiStatus, setAiStatus] = useState<Record<string, AiState>>({});

  // Keep the latest annotations in a ref so async syncs always serialize the
  // current set (regenerate-from-local-set) without stale closures.
  const annotationsRef = useRef<Annotation[]>([]);
  annotationsRef.current = annotations;

  // Load-gating: which docId the in-memory set was actually loaded FOR, and the
  // in-flight load. Until loadedDocRef matches the current docId, NOTHING may
  // persist or sync — a mutation/sync in that window would act on an empty (or
  // previous doc's) set and overwrite good data. This is exactly what wiped the
  // Reading: Phronesis note: a sync fired mid-navigation with an empty set.
  const docIdRef = useRef<string | null>(null);
  docIdRef.current = docId;
  const loadedDocRef = useRef<string | null>(null);
  const loadPromiseRef = useRef<Promise<void>>(Promise.resolve());

  // Debounce sync-failure toasts so a burst of failures (e.g. rate limiting
  // during a link-capture spree) doesn't spam the screen.
  const lastSyncToastRef = useRef(0);

  // Load annotations whenever the document changes.
  //
  // IMPORTANT: load the FULL stored set — do NOT trim to the currently-parsed
  // sentence range here. Trimming at load meant that if a document parsed into
  // fewer sentences than when its comments were made (or hadn't finished parsing
  // yet), those comments were dropped from the in-memory set — and the next save
  // then persisted that trimmed set, permanently losing them. Out-of-range
  // comments simply don't paint a highlight; they are never discarded.
  useEffect(() => {
    loadedDocRef.current = null;
    // Clear synchronously so the previous doc's highlights never bleed into the
    // new doc (and can never be persisted under its id).
    annotationsRef.current = [];
    setAnnotations([]);
    if (!docId) return;
    const target = docId;
    loadPromiseRef.current = loadAnnotations(target).then((loaded) => {
      // Stale-load guard: if the user navigated again while this load was in
      // flight, drop the result — a late resolve must never clobber the doc
      // that's now open.
      if (docIdRef.current !== target) return;
      // Migrate old comment="link" style to the new linkTarget field.
      let migrated = false;
      const next = loaded.map((a) => {
        if (/^link$/i.test((a.comment ?? '').trim()) && a.linkTarget === undefined) {
          migrated = true;
          return { ...a, linkTarget: '', comment: '' };
        }
        return a;
      });
      if (migrated) saveAnnotations(target, next);
      annotationsRef.current = next;
      setAnnotations(next);
      loadedDocRef.current = target;
      // Auto-heal: regenerate the Book_Note from the freshly-loaded set, so a
      // note wiped or missed by an earlier failed sync repairs itself the next
      // time the doc is opened. Idempotent; skipped for empty sets.
      if (next.length > 0) {
        void syncBookNote(target, docTitle ?? target, next);
      }
    });
    setPendingPopover(null);
    setActiveThreadId(null);
    // docTitle changes together with docId (both set when a doc opens); it is
    // only read inside the resolved load, so docId alone drives the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  /**
   * Run `fn` once the CURRENT doc's annotations have loaded. Executes
   * immediately in the (overwhelmingly common) already-loaded case; during the
   * brief load window it queues behind the load, and drops the action if the
   * user has meanwhile navigated to a different doc.
   */
  const runWhenLoaded = useCallback((fn: () => void) => {
    const target = docIdRef.current;
    if (!target) return;
    if (loadedDocRef.current === target) {
      fn();
      return;
    }
    void loadPromiseRef.current.then(() => {
      if (docIdRef.current === target && loadedDocRef.current === target) fn();
    });
  }, []);

  /** Persist locally (source of truth) and best-effort sync to Obsidian. */
  const persistAndSync = useCallback(
    (next: Annotation[], touchedId?: string, syncOptions?: SyncOptions) => {
      annotationsRef.current = next;
      setAnnotations(next);
      if (!docId) return;
      saveAnnotations(docId, next, syncOptions?.allowEmpty ? { allowEmpty: true } : undefined);

      const id = touchedId;
      if (id) setSyncStatus((s) => ({ ...s, [id]: 'saving' }));
      void syncBookNote(docId, docTitle ?? docId, next, syncOptions).then((res) => {
        if (!res.ok && Date.now() - lastSyncToastRef.current > 30_000) {
          lastSyncToastRef.current = Date.now();
          window.showToast?.('Obsidian sync failed — your notes are still saved locally', 'error');
        }
        if (!id) return;
        setSyncStatus((s) => ({ ...s, [id]: res.ok ? 'idle' : 'error' }));
      });
    },
    [docId, docTitle],
  );

  const beginSelection = useCallback(
    (range: Range, container: HTMLElement) => {
      const anchor = deriveAnchor(range, container);
      if (!anchor) return; // empty/collapsed selection → no popover (Req 2.7)
      onSelectionPauseReadAlong(); // pause read-along on selection (Req 1.10/2.8)

      const domRect =
        typeof range.getBoundingClientRect === 'function'
          ? range.getBoundingClientRect()
          : { top: 0, left: 0, width: 0, height: 0 };

      // Capture the underlying concept when the selection is on a Wikipedia
      // link: pre-fill the link target and turn link mode on, so the saved note
      // gets [[The Holocaust|selected text]] rather than a bare highlight.
      const wikiTitle = wikiTitleFromRange(range);

      // Flag selections that overlap an existing highlight so the popover can
      // tell the user (and we avoid silently double-highlighting the same span).
      const sel = anchor.selectedText.trim();
      const alreadyHighlighted = annotationsRef.current.some((a) => {
        const overlapSentences =
          a.startSentenceIndex <= anchor.endSentenceIndex &&
          a.endSentenceIndex >= anchor.startSentenceIndex;
        if (!overlapSentences) return false;
        const at = (a.selectedText ?? '').trim();
        if (!at || !sel) return false;
        return at === sel || at.includes(sel) || sel.includes(at);
      });

      // Is this term ALREADY LINKED somewhere else in the article? (Distinct from
      // alreadyHighlighted, which is same-span overlap.) The popover surfaces this
      // so the reader knows before making a second link to the same concept.
      const alreadyLinked = !!findLinkByKey(annotationsRef.current, linkKey(wikiTitle ?? sel));

      setPendingPopover({
        anchor,
        rect: {
          top: domRect.top,
          left: domRect.left,
          width: domRect.width,
          height: domRect.height,
        },
        text: '',
        linkEnabled: wikiTitle !== null,
        linkTarget: wikiTitle ?? '',
        alreadyHighlighted,
        alreadyLinked,
      });
    },
    [onSelectionPauseReadAlong],
  );

  const setPendingText = useCallback((text: string) => {
    setPendingPopover((p) => (p ? { ...p, text } : p));
  }, []);

  const setPendingLink = useCallback((enabled: boolean) => {
    setPendingPopover((p) => (p ? { ...p, linkEnabled: enabled } : p));
  }, []);

  const setPendingLinkTarget = useCallback((target: string) => {
    setPendingPopover((p) => (p ? { ...p, linkTarget: target } : p));
  }, []);

  const cancelPending = useCallback(() => setPendingPopover(null), []);

  const commitPending = useCallback(() => {
    // Read the pending popover from the ref and run side effects OUTSIDE any
    // state-updater function — React 18 StrictMode double-invokes updaters in
    // dev, which would otherwise create the annotation (and Obsidian note) twice.
    const p = pendingPopoverRef.current;
    if (!p) return;
    const comment = p.text.trim();
    // Keep the annotation if it has a comment OR it's a link (link-only
    // highlights have no comment text — they're just a colored [[wikilink]]).
    if (comment.length === 0 && !p.linkEnabled) {
      setPendingPopover(null); // discard empty (Req 3.3)
      return;
    }
    if (!docId) {
      setPendingPopover(null);
      return;
    }

    // Persist once the doc's stored set has loaded, so an early commit can
    // never overwrite the store with just this one annotation.
    runWhenLoaded(() => {
      const now = new Date().toISOString();
      const annotation: Annotation = {
        id: uuid(),
        docId,
        startSentenceIndex: p.anchor.startSentenceIndex,
        endSentenceIndex: p.anchor.endSentenceIndex,
        selectedText: p.anchor.selectedText,
        comment,
        // A captured wiki title wins; otherwise fall back to the selected text
        // with its first letter capitalized so plain-text links still get a
        // proper name (e.g. "mercantilism" → [[Mercantilism|mercantilism]]).
        ...(p.linkEnabled
          ? { linkTarget: p.linkTarget.trim() || capitalizeFirst(p.anchor.selectedText) }
          : {}),
        aiReplies: [],
        createdAt: now,
        updatedAt: now,
      };
      persistAndSync([...annotationsRef.current, annotation], annotation.id);
    });
    setPendingPopover(null);
  }, [docId, persistAndSync, runWhenLoaded]);

  /**
   * Capture a Wikipedia link as a link-annotation directly from its anchor
   * element — no drag-selection, no popover. Used by the reader's "link mode"
   * where a single click on a wiki link files it instantly. Deduplicates against
   * an existing link on the same span so repeated clicks don't stack highlights,
   * and deliberately does NOT open the thread panel so many links can be filed
   * in quick succession.
   */
  const addWikiLink = useCallback(
    (range: Range, container: HTMLElement, wikiTitle: string): AddWikiLinkResult => {
      if (!docId) return { status: 'noop' };
      // Derive the anchor NOW — the DOM range may be invalidated by the time a
      // deferred persist runs.
      const anchor = deriveAnchor(range, container);
      if (!anchor) return { status: 'noop' };
      const sel = anchor.selectedText.trim();
      const term = (wikiTitle || sel).replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();
      if (!term && !sel) return { status: 'noop' };

      // Already linked ANYWHERE in this article (not just this span)? Don't stack
      // a duplicate — report it so the caller can flag "already linked". This is
      // what stops you re-linking a term you captured earlier without realizing.
      // (Only reliable once the stored set has loaded; the deferred path below
      // re-checks inside runWhenLoaded.)
      if (loadedDocRef.current === docId) {
        const existing = findLinkByKey(annotationsRef.current, linkKey(term || sel));
        if (existing) {
          return { status: 'duplicate', existingId: existing.id, term: term || sel };
        }
      }

      const now = new Date().toISOString();
      const annotation: Annotation = {
        id: uuid(),
        docId,
        startSentenceIndex: anchor.startSentenceIndex,
        endSentenceIndex: anchor.endSentenceIndex,
        selectedText: anchor.selectedText,
        comment: '',
        linkTarget: term || capitalizeFirst(anchor.selectedText),
        aiReplies: [],
        createdAt: now,
        updatedAt: now,
      };
      runWhenLoaded(() => {
        // Re-check dedup against the (now definitely loaded) full set.
        const dup = findLinkByKey(annotationsRef.current, linkKey(term || sel));
        if (dup) return; // captured earlier — skip silently
        persistAndSync([...annotationsRef.current, annotation], annotation.id);
      });
      return { status: 'added', id: annotation.id };
    },
    [docId, persistAndSync, runWhenLoaded],
  );

  const addNote = useCallback(
    (comment: string, sentenceIndex: number) => {
      const text = comment.trim();
      if (!text || !docId) return;
      runWhenLoaded(() => {
        const idx = Math.max(0, Math.min(sentenceIndex, Math.max(0, sentenceCount - 1)));
        const now = new Date().toISOString();
        const annotation: Annotation = {
          id: uuid(),
          docId,
          startSentenceIndex: idx,
          endSentenceIndex: idx,
          selectedText: '', // standalone note — no anchored passage
          comment: text,
          aiReplies: [],
          createdAt: now,
          updatedAt: now,
        };
        persistAndSync([...annotationsRef.current, annotation], annotation.id);
      });
    },
    [docId, sentenceCount, persistAndSync, runWhenLoaded],
  );

  const setActiveThread = useCallback((id: string | null) => {
    setActiveThreadId(id);
  }, []);

  const editAnnotation = useCallback(
    (id: string, comment: string) => {
      runWhenLoaded(() => {
        const next = annotationsRef.current.map((a) =>
          a.id === id
            ? { ...a, comment, updatedAt: new Date().toISOString() }
            : a,
        );
        persistAndSync(next, id);
      });
    },
    [persistAndSync, runWhenLoaded],
  );

  const editSelectedText = useCallback(
    (id: string, selectedText: string) => {
      const trimmed = selectedText.trim();
      if (!trimmed) return;
      runWhenLoaded(() => {
        const next = annotationsRef.current.map((a) =>
          a.id === id
            ? { ...a, selectedText: trimmed, updatedAt: new Date().toISOString() }
            : a,
        );
        persistAndSync(next, id);
      });
    },
    [persistAndSync, runWhenLoaded],
  );

  const editLinkTarget = useCallback(
    (id: string, linkTarget: string) => {
      const trimmed = linkTarget.trim().replace(/^\[\[|\]\]$/g, '').trim();
      runWhenLoaded(() => {
        const next = annotationsRef.current.map((a) =>
          a.id === id
            // Setting a target also makes this annotation a link (linkTarget !== undefined).
            ? { ...a, linkTarget: trimmed, updatedAt: new Date().toISOString() }
            : a,
        );
        persistAndSync(next, id);
      });
    },
    [persistAndSync, runWhenLoaded],
  );

  const deleteAnnotation = useCallback(
    (id: string) => {
      runWhenLoaded(() => {
        const next = annotationsRef.current.filter((a) => a.id !== id);
        // Sync uses the regenerated set; attribute status to the deleted id so a
        // failure still surfaces somewhere actionable. Deleting the last
        // annotation legitimately empties the note — allowEmpty bypasses the
        // wipe guard for exactly this case.
        persistAndSync(next, id, { allowEmpty: true });
      });
      setActiveThreadId((cur) => (cur === id ? null : cur));
    },
    [persistAndSync, runWhenLoaded],
  );

  const requestAiReply = useCallback(
    async (id: string, followUp?: string) => {
      const target = annotationsRef.current.find((a) => a.id === id);
      if (!target) return;
      const question = followUp?.trim();

      setAiStatus((s) => ({ ...s, [id]: 'pending' }));
      try {
        // Surrounding context = the local paragraph (a few sentences either side
        // of the highlight), NOT the whole document. The model supplies general
        // knowledge; we supply just enough of where you are to ground the answer.
        const CONTEXT_RADIUS = 3;
        const from = Math.max(0, target.startSentenceIndex - CONTEXT_RADIUS);
        const to = Math.min(sentences.length - 1, target.endSentenceIndex + CONTEXT_RADIUS);
        const passage = target.selectedText;
        // A long highlight is its own context; repeating it as the
        // "surrounding paragraph" would double the request.
        const context = passage.length > LONG_PASSAGE_CHARS
          ? ''
          : sentences.slice(from, to + 1).join(' ').trim();

        // Prior turns in this thread, so follow-ups continue the conversation.
        const history = target.aiReplies
          .map((r) => `${r.prompt ? `Me: ${r.prompt}\n` : ''}AI: ${r.content}`)
          .join('\n\n');

        const message =
          `While reading${docTitle ? ` "${docTitle}"` : ''} I highlighted:\n` +
          `"${passage}"\n\nMy note: ${target.comment}\n\n` +
          (context ? `Surrounding paragraph: "${context}"\n\n` : '') +
          (history ? `Earlier in this thread:\n${history}\n\n` : '') +
          (question
            ? `My follow-up question: ${question}`
            : `Please respond in that context.`);

        const content = await requestChatReply(message);
        const reply: AiReply = {
          id: uuid(),
          content,
          ...(question ? { prompt: question } : {}),
          createdAt: new Date().toISOString(),
        };

        const next = annotationsRef.current.map((a) =>
          a.id === id
            ? {
                ...a,
                aiReplies: [...a.aiReplies, reply],
                updatedAt: new Date().toISOString(),
              }
            : a,
        );
        setAiStatus((s) => ({ ...s, [id]: 'idle' }));
        persistAndSync(next, id);
      } catch {
        // Retain the comment; surface an in-thread error (Req 5.6).
        setAiStatus((s) => ({ ...s, [id]: 'error' }));
      }
    },
    [docTitle, sentences, persistAndSync],
  );

  const retrySync = useCallback(
    (id: string) => {
      if (!docId) return;
      setSyncStatus((s) => ({ ...s, [id]: 'saving' }));
      runWhenLoaded(() => {
        void syncBookNote(docId, docTitle ?? docId, annotationsRef.current).then(
          (res) => {
            setSyncStatus((s) => ({ ...s, [id]: res.ok ? 'idle' : 'error' }));
          },
        );
      });
    },
    [docId, docTitle, runWhenLoaded],
  );

  // Re-sync the Book_Note without touching an annotation — used when the running
  // summary changes (syncBookNote reads the latest summaries from the store).
  //
  // MUST wait for the doc's annotations to load: this is the path that wiped
  // Reading: Phronesis — a summary-strip commit fired mid-navigation while the
  // in-memory set was still empty, and the regenerated note erased every
  // synced comment (the wipe guard in syncBookNote is the second line of
  // defense for the same failure).
  const getLoadedAnnotations = useCallback(async (): Promise<Annotation[] | null> => {
    const target = docId;
    if (!target) return null;
    if (loadedDocRef.current !== target) await loadPromiseRef.current;
    if (docIdRef.current !== target || loadedDocRef.current !== target) return null;
    return annotationsRef.current.map((annotation) => ({
      ...annotation,
      aiReplies: [...(annotation.aiReplies ?? [])],
    }));
  }, [docId]);

  const resyncNote = useCallback(async (): Promise<boolean> => {
    const target = docId;
    if (!target) return false;

    // Wait for this exact document's annotation load. A navigation during the
    // wait invalidates the request rather than syncing an empty or wrong set.
    if (loadedDocRef.current !== target) await loadPromiseRef.current;
    if (docIdRef.current !== target || loadedDocRef.current !== target) return false;

    const res = await syncBookNote(target, docTitle ?? target, annotationsRef.current);
    if (!res.ok && Date.now() - lastSyncToastRef.current > 30_000) {
      lastSyncToastRef.current = Date.now();
      window.showToast?.('Obsidian sync failed — your summary is still saved locally', 'error');
    }
    return res.ok;
  }, [docId, docTitle]);

  return useMemo(
    () => ({
      annotations,
      pendingPopover,
      activeThreadId,
      syncStatus,
      aiStatus,
      beginSelection,
      setPendingText,
      setPendingLink,
      setPendingLinkTarget,
      commitPending,
      cancelPending,
      addNote,
      addWikiLink,
      setActiveThread,
      editAnnotation,
      editSelectedText,
      editLinkTarget,
      deleteAnnotation,
      requestAiReply,
      retrySync,
      getLoadedAnnotations,
      resyncNote,
    }),
    [
      annotations,
      pendingPopover,
      activeThreadId,
      syncStatus,
      aiStatus,
      beginSelection,
      setPendingText,
      setPendingLink,
      setPendingLinkTarget,
      commitPending,
      cancelPending,
      addNote,
      addWikiLink,
      setActiveThread,
      editAnnotation,
      editSelectedText,
      editLinkTarget,
      deleteAnnotation,
      requestAiReply,
      retrySync,
      getLoadedAnnotations,
      resyncNote,
    ],
  );
}
