'use client';

/**
 * Reading list / ranking page.
 * Feature: ranking-page-redesign
 *
 * Bucket-first layout: every item lives in exactly one bucket (`inbox`, `next`,
 * `shelf`, `topic`, `dismissed`) describing where it sits in the reading flow,
 * while its `kind` is carried along only as a reference label. Captured links
 * land in the Inbox; the reader triages them into the Shelf, Topics, or the
 * Dismissed tombstone set. A single ranked Up Next queue is the centerpiece.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readArticleLibrary } from '@/lib/reader-sources/library';
import { loadAnnotations } from '@/lib/reader-workspace/annotation-store';
import { conceptTerm, normalizeKey } from '@/lib/knowledge-map/build-map';
import {
  loadReadingList, saveReadingList, reconcileSeeds, bucketQueue, reorderWithinBucket,
  moveToBucket, setRead, removeItem, dismissItem, fileItem, wordCount, estimateMinutes, lengthLabel, timeLabel,
  totalMinutes, formatMinutes, READABLE_KINDS,
  type ReadingItem, type ItemKind, type Seed, type Bucket,
} from '@/lib/reading-list/store';

/** Human labels for the readable kinds offered by the "+ Add" kind selector. */
const READABLE_KIND_LABELS: Record<string, string> = {
  article: 'Article',
  sep: 'SEP',
  book: 'Book',
  paper: 'Paper',
};

/**
 * Heuristic gate for whether a captured-link title reads like a real title:
 * trimmed, starts with an uppercase letter or a digit, and is at most 8 words.
 * Used by the Inbox line to surface links that are unlikely to be worth reading
 * so the reader can clear (dismiss) them in one action (R13.5).
 */
function looksLikeTitle(t: string): boolean {
  const trimmed = t.trim();
  if (!trimmed) return false;
  if (!/^[A-Z0-9]/.test(trimmed)) return false;
  return trimmed.split(/\s+/).length <= 8;
}

interface RowProps {
  it: ReadingItem;
  idx: number;
  isOver: boolean;
  isDragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragEnterRow: (id: string) => void;
  onDropRow: (id: string) => void;
  onToggleRead: (id: string) => void;
  onRemove: (id: string) => void;
  /** When true, the row gets subtle emphasis (`border-primary/40`) — used for
   *  Up Next row #1. Ignored while the row is a drop target or being dragged. */
  emphasize?: boolean;
  /** Optional "↓ Shelf" hover action (Up Next → shelf, R15.3). When omitted the
   *  button is not rendered, keeping the row reusable across regions. */
  onMoveToShelf?: (id: string) => void;
}

/**
 * One reading-list row, memoized. With stable callbacks from the parent, only a
 * row whose isOver/isDragging actually changes re-renders — so dragging stays
 * smooth across hundreds of items. Only the ⠿ handle is draggable, so the rest
 * of the row stays selectable/copyable. Optional action props (`onMoveToShelf`)
 * keep the row reusable across the bucket regions; when a callback is omitted
 * its control is not rendered. (Used by the Up Next drag work in task 9.4.)
 */
const Row = memo(function Row({
  it, idx, isOver, isDragging,
  onDragStart, onDragEnd, onDragEnterRow, onDropRow, onToggleRead, onRemove,
  emphasize, onMoveToShelf,
}: RowProps) {
  const borderClass = isOver && !isDragging
    ? 'border-primary/60'
    : emphasize ? 'border-primary/40' : 'border-border/40';
  return (
    <li
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={() => onDragEnterRow(it.id)}
      onDrop={(e) => { e.stopPropagation(); onDropRow(it.id); }}
      className={`group flex items-center gap-3 rounded-md border bg-card px-2.5 py-2 transition-colors select-text ${borderClass} ${isDragging ? 'opacity-50' : ''}`}
    >
      <span
        draggable
        onDragStart={() => onDragStart(it.id)}
        onDragEnd={onDragEnd}
        className="cursor-grab select-none text-muted-foreground/40 group-hover:text-muted-foreground"
        title="Drag to rank"
      >⠿</span>
      <span className="w-5 text-right text-[11px] tabular-nums text-muted-foreground/60 select-none">{idx + 1}</span>
      <button
        onClick={() => onToggleRead(it.id)}
        title={it.read ? 'Read — click to unmark' : 'Mark read'}
        className={`h-3 w-3 shrink-0 rounded-full border ${it.read ? 'bg-amber-400 border-amber-400' : 'border-muted-foreground/50'}`}
      />
      <span className={`min-w-0 flex-1 truncate text-sm ${it.read ? 'text-muted-foreground' : ''}`}>{it.title}</span>
      <span className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
        {lengthLabel(it) && <span>{lengthLabel(it)}</span>}
        {timeLabel(it) && <span className="text-muted-foreground/70">{timeLabel(it)}</span>}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/50">{it.kind}</span>
      {onMoveToShelf && (
        <button
          onClick={() => onMoveToShelf(it.id)}
          className="rounded px-1 py-0.5 text-xs text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:text-foreground"
          title="Move to shelf"
        >↓ Shelf</button>
      )}
      <button onClick={() => onRemove(it.id)} className="rounded px-1 py-0.5 text-xs text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:text-red-400" title="Remove">✕</button>
    </li>
  );
});

interface ShelfRowProps {
  it: ReadingItem;
  onToggleRead: (id: string) => void;
  onMoveToNext: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * One Shelf row, memoized. The Shelf is a flat, filterable list with NO dragging
 * (R16) — so this row omits the ⠿ handle, rank number, and drag wiring of the
 * ranked `Row`, while keeping the same visual language (rounded bordered row,
 * `text-sm` title, `text-xs` metadata, ● / ○ read dot). Its promote action is
 * "↑ Up next" (`moveToBucket(items, id, 'next')`, appends to the back — R16.4).
 * Stable callbacks keep the memo effective across a long shelf.
 */
const ShelfRow = memo(function ShelfRow({ it, onToggleRead, onMoveToNext, onRemove }: ShelfRowProps) {
  return (
    <li className="group flex items-center gap-3 rounded-md border border-border/40 bg-card px-2.5 py-2 transition-colors select-text">
      <button
        onClick={() => onToggleRead(it.id)}
        title={it.read ? 'Read — click to unmark' : 'Mark read'}
        className={`h-3 w-3 shrink-0 rounded-full border ${it.read ? 'bg-amber-400 border-amber-400' : 'border-muted-foreground/50'}`}
      />
      <span className={`min-w-0 flex-1 truncate text-sm ${it.read ? 'text-muted-foreground' : ''}`}>{it.title}</span>
      <span className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
        {lengthLabel(it) && <span>{lengthLabel(it)}</span>}
        {timeLabel(it) && <span className="text-muted-foreground/70">{timeLabel(it)}</span>}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/50">{it.kind}</span>
      <button
        onClick={() => onMoveToNext(it.id)}
        className="rounded px-1 py-0.5 text-xs text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:text-foreground"
        title="Move to Up Next"
      >↑ Up next</button>
      <button onClick={() => onRemove(it.id)} className="rounded px-1 py-0.5 text-xs text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:text-red-400" title="Remove">✕</button>
    </li>
  );
});

/** Shelf filter chips: "All" (default) plus one per readable kind. `kind: null`
 *  means no `kind` filter (show every shelf item). (R16.2) */
const SHELF_FILTERS: { label: string; kind: ItemKind | null }[] = [
  { label: 'All', kind: null },
  { label: 'Articles', kind: 'article' },
  { label: 'SEP', kind: 'sep' },
  { label: 'Books', kind: 'book' },
  { label: 'Papers', kind: 'paper' },
];

/** The Shelf shows at most this many rows before the "Show all {n}" expander. */
const SHELF_PAGE = 30;

export function ReadingList() {
  const [items, setItems] = useState<ReadingItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [hideRead, setHideRead] = useState(false);
  const [adding, setAdding] = useState(false);
  // Shelf region state (task 9.5). `shelfFilter` is a client-side `kind` filter
  // with "All" (null) as the default; `shelfSearch` is a case-insensitive title
  // search; `shelfShowAll` toggles the "Show all {n}" expander past 30 rows.
  const [shelfFilter, setShelfFilter] = useState<ItemKind | null>(null);
  const [shelfSearch, setShelfSearch] = useState('');
  const [shelfShowAll, setShelfShowAll] = useState(false);
  // Topics region (task 9.6): collapsed by default. Toggling shows the wrapped
  // chip strip of `topic`-bucket items (R17.1).
  const [topicsOpen, setTopicsOpen] = useState(false);
  // Finished region (task 9.7): collapsed by default. Toggling lists the read
  // readables (bucket `shelf` or `next`) as a record; clicking a read-dot
  // un-reads the item (R18.1/R18.2).
  const [finishedOpen, setFinishedOpen] = useState(false);
  // Ids currently open in the triage panel. `null` = panel closed. The actual
  // TriagePanel component is built in task 9.3; the Inbox "Sort →" control wires
  // this state now so triage can open. (R13.3)
  const [triageIds, setTriageIds] = useState<string[] | null>(null);

  // Load + seed from saved articles and the links you captured while reading.
  // Build bucket-aware seeds, reconcile against saved data, then persist. A seed
  // source that fails to load is treated as empty so the page never crashes.
  useEffect(() => {
    const current = loadReadingList();
    setItems(current);
    setMounted(true);
    (async () => {
      // Article-library seeds → default bucket `shelf`. Treat a failing source
      // as empty and continue (R19.3).
      let lib: Awaited<ReturnType<typeof readArticleLibrary>> = [];
      try {
        lib = await readArticleLibrary();
      } catch {
        lib = [];
      }
      const articleSeeds: Seed[] = lib.map((a) => {
        const words = wordCount(a.content);
        return {
          id: a.id, title: a.title, source: 'article', bucket: 'shelf',
          kind: a.type === 'sep' ? 'sep' : 'article', words, estMinutes: estimateMinutes(words),
        };
      });

      // Captured-link seeds → default bucket `inbox`, deduped by id. Each
      // annotation source is guarded so one failure doesn't abort the rest.
      const linkSeeds: Seed[] = [];
      const seenKey = new Set<string>();
      for (const a of lib) {
        let anns: Awaited<ReturnType<typeof loadAnnotations>> = [];
        try {
          anns = await loadAnnotations(a.id);
        } catch {
          anns = [];
        }
        for (const ann of anns) {
          const term = conceptTerm(ann);
          if (!term) continue;
          const id = `link-${normalizeKey(term)}`;
          if (seenKey.has(id)) continue;
          seenKey.add(id);
          linkSeeds.push({ id, title: term, kind: 'unsorted', source: 'link', bucket: 'inbox' });
        }
      }

      const reconciled = reconcileSeeds(current, [...articleSeeds, ...linkSeeds]);
      setItems(reconciled);
      saveReadingList(reconciled);
    })();
  }, []);

  // Notion-style edge auto-scroll while dragging (you can't grab the scrollbar
  // mid-drag). Big edge zone, quadratic ramp, and it ACCELERATES the longer you
  // hold at the edge — so you can fling through a long list fast. (Preserved for
  // the Up Next drag work in task 9.4.)
  useEffect(() => {
    const EDGE = 150;    // how deep the trigger zone is, px
    const BASE = 55;     // base max px/frame at the very edge
    const ACCEL = 0.12;  // how fast it speeds up while held
    const ACCEL_MAX = 4; // up to 4× the base speed
    let speed = 0;       // signed base speed from cursor position
    let mult = 1;        // grows while held at an edge
    let raf: number | null = null;
    const tick = () => {
      if (speed !== 0) {
        mult = Math.min(mult + ACCEL, ACCEL_MAX);
        window.scrollBy(0, speed * mult);
        raf = requestAnimationFrame(tick);
      } else { mult = 1; raf = null; }
    };
    const onDragOver = (e: DragEvent) => {
      const h = window.innerHeight, y = e.clientY;
      let frac = 0; // -1..1, how far into the edge zone (sign = direction)
      if (y < EDGE) frac = -(EDGE - y) / EDGE;
      else if (y > h - EDGE) frac = (y - (h - EDGE)) / EDGE;
      // quadratic: gentle near the threshold, very fast at the very edge.
      speed = frac === 0 ? 0 : Math.sign(frac) * Math.ceil(frac * frac * BASE);
      if (speed !== 0 && raf == null) raf = requestAnimationFrame(tick);
    };
    const stop = () => { speed = 0; mult = 1; if (raf != null) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', stop);
    window.addEventListener('dragend', stop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', stop);
      window.removeEventListener('dragend', stop);
      stop();
    };
  }, []);

  // Shelf list (task 9.5): select the shelf-bucket items via `bucketQueue`
  // (which also excludes dismissed), then re-sort by `addedAt` DESCENDING for
  // display — the shelf ignores `order`, which is only meaningful for ranking
  // `next` (R16.1). Then apply the client-side `kind` filter (R16.2), the
  // case-insensitive title search (R16.3), and the "Hide read" exclusion
  // (R16.5). Row capping (first 30 + "Show all") is applied at render time.
  const shelfFiltered = useMemo(() => {
    const q = shelfSearch.trim().toLowerCase();
    return bucketQueue(items, 'shelf')
      .slice()
      .sort((a, b) => b.addedAt - a.addedAt)
      .filter((it) =>
        (shelfFilter === null || it.kind === shelfFilter) &&
        (!hideRead || !it.read) &&
        (q === '' || it.title.toLowerCase().includes(q)),
      );
  }, [items, shelfFilter, shelfSearch, hideRead]);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  // All stable (functional setState + a ref for the dragged id) so the memoized
  // rows below never re-render just because a callback identity changed. Only the
  // row whose isOver/isDragging flips re-renders during a drag — that's what makes
  // it fast over hundreds of items. (Preserved for the Up Next drag work in 9.4.)
  const dragIdRef = useRef<string | null>(null);

  const applyFn = useCallback((fn: (prev: ReadingItem[]) => ReadingItem[]) => {
    setItems((prev) => { const next = fn(prev); saveReadingList(next); return next; });
  }, []);

  // Persisting whole-list update used by the triage panel, which computes each
  // next list from a snapshot it holds (rather than a functional updater).
  const update = useCallback((next: ReadingItem[]) => {
    setItems(next); saveReadingList(next);
  }, []);

  const onToggleRead = useCallback((id: string) =>
    applyFn((prev) => setRead(prev, id, !(prev.find((i) => i.id === id)?.read))), [applyFn]);
  const onRemoveCb = useCallback((id: string) =>
    applyFn((prev) => removeItem(prev, id)), [applyFn]);
  // Up Next "↓ Shelf" hover action: park a queued item on the shelf (appends to
  // the back of the shelf bucket's order). Stable so the memoized rows don't
  // re-render on identity change. (R15.3)
  const onMoveToShelf = useCallback((id: string) =>
    applyFn((prev) => moveToBucket(prev, id, 'shelf')), [applyFn]);
  // Shelf "↑ Up next" action: promote a shelf item into the ranked queue,
  // appending to the back of the `next` bucket's order (R16.4). Stable so the
  // memoized ShelfRows don't re-render on identity change.
  const onMoveToNext = useCallback((id: string) =>
    applyFn((prev) => moveToBucket(prev, id, 'next')), [applyFn]);
  // Finished "read-dot" action: un-read a finished item explicitly via
  // `setRead(items, id, false)` so it drops back out of the Finished record
  // regardless of its current flag (R18.2). Stable for a long finished list.
  const onUnread = useCallback((id: string) =>
    applyFn((prev) => setRead(prev, id, false)), [applyFn]);

  // Append a new manual item and persist. A manual item lands on the shelf at
  // the back of the shelf bucket's `order` sequence (R12.4).
  const onAdd = useCallback((item: ReadingItem) => {
    applyFn((prev) => {
      const backOrder = prev.reduce(
        (m, i) => (i.bucket === 'shelf' && i.order > m ? i.order : m), -1,
      ) + 1;
      return [...prev, { ...item, bucket: 'shelf' as Bucket, order: backOrder }];
    });
    setAdding(false);
  }, [applyFn]);

  const onDragStart = useCallback((id: string) => { dragIdRef.current = id; setDragId(id); }, []);
  const onDragEnd = useCallback(() => { dragIdRef.current = null; setDragId(null); setOverId(null); }, []);
  const onDragEnterRow = useCallback((id: string) => setOverId(id), []);

  const onDropRow = useCallback((targetId: string) => {
    const dragged = dragIdRef.current;
    dragIdRef.current = null; setDragId(null); setOverId(null);
    if (!dragged || dragged === targetId) return;
    // Ranking is restricted to within a bucket; a cross-bucket drop is a no-op.
    applyFn((prev) => reorderWithinBucket(prev, dragged, targetId));
  }, [applyFn]);

  // ── Inbox handlers ─────────────────────────────────────────────────────────
  // Dismiss the given ids in one persisted pass (dismissed items become
  // tombstones and are never rendered). Used by both "Dismiss all" and the
  // looksLikeTitle "clear them" microcopy.
  const dismissIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    applyFn((prev) => ids.reduce((acc, id) => dismissItem(acc, id), prev));
  }, [applyFn]);

  if (!mounted) return null;

  // Header subline: only shown while Up Next has items. `totalMinutes` returns a
  // raw number, so it is formatted with `formatMinutes` (not `timeLabel`, which
  // takes a ReadingItem); the template supplies the leading `~`. (R12.2)
  const nextItems = bucketQueue(items, 'next');
  const nextCount = nextItems.length;

  // Inbox line: freshly captured, un-triaged links. Rendered only when the inbox
  // is non-empty (R13.1/R13.2). `untitledIds` are inbox items that fail the
  // looksLikeTitle gate — "clear them" dismisses exactly those (R13.5).
  const inboxItems = bucketQueue(items, 'inbox');
  const untitledIds = inboxItems.filter((i) => !looksLikeTitle(i.title)).map((i) => i.id);

  // Topics: reference terms kept as a collapsed chip strip (R17). Selected via
  // `bucketQueue(items, 'topic')` (dismissed excluded). The section renders only
  // when there are topic items to avoid clutter; expanding shows wrapped chips
  // with a dismiss (✕) control each (R17.1–R17.3).
  const topicItems = bucketQueue(items, 'topic');

  // Shelf: cap at the first 30 filtered rows unless the reader expanded it
  // (R16.6). The "Show all {n}" expander reports the full filtered count.
  const shelfShown = shelfShowAll ? shelfFiltered : shelfFiltered.slice(0, SHELF_PAGE);

  // Finished: a record of read readables (R18.1). We want read items across the
  // `shelf` AND `next` buckets specifically, so we filter `items` directly
  // rather than using `bucketQueue` (which selects a single bucket). Dismissed
  // items are excluded implicitly since only `shelf`/`next` are included.
  const finishedItems = items.filter(
    (i) => i.read === true && (i.bucket === 'shelf' || i.bucket === 'next'),
  );

  const openTriage = () => setTriageIds(inboxItems.map((i) => i.id));
  const dismissAllInbox = () => {
    if (inboxItems.length === 0) return;
    if (!window.confirm(`Dismiss all ${inboxItems.length} captured links? This can't be undone.`)) return;
    dismissIds(inboxItems.map((i) => i.id));
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reading list</h1>
          {nextCount > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              {nextCount} up next · ~{formatMinutes(totalMinutes(items))}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={hideRead} onChange={(e) => setHideRead(e.target.checked)} />
            Hide read
          </label>
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-xs hover:bg-muted"
          >
            + Add
          </button>
        </div>
      </header>

      {adding && (
        <AddForm onAdd={onAdd} onCancel={() => setAdding(false)} />
      )}

      {/* Inbox: one collapsed line, shown only when the inbox has items (R13.1,
          R13.2). "Sort →" opens triage (R13.3); "Dismiss all" confirms once then
          dismisses every inbox item (R13.4). The looksLikeTitle gate surfaces
          untitled links with a "clear them" action that dismisses them (R13.5). */}
      {inboxItems.length > 0 && (
        <section className="rounded-md border border-border/40 bg-card px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-muted-foreground">
              Inbox · {inboxItems.length} captured {inboxItems.length === 1 ? 'link' : 'links'}
            </span>
            <button
              onClick={openTriage}
              className="rounded px-1.5 py-0.5 text-xs text-foreground hover:bg-muted"
            >
              Sort →
            </button>
            <button
              onClick={dismissAllInbox}
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground/70 hover:text-red-400 hover:bg-muted"
            >
              Dismiss all
            </button>
          </div>
          {untitledIds.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground/70">
              {untitledIds.length} without a clear title ·{' '}
              <button
                onClick={() => dismissIds(untitledIds)}
                className="underline underline-offset-2 hover:text-red-400"
              >
                clear them
              </button>
            </p>
          )}
        </section>
      )}

      {/* Triage panel: one-at-a-time modal opened by the Inbox "Sort →" control.
          Three outcomes (Read it / Topic / Dismiss) with a compact readable-kind
          sub-picker, snapshot-undo, and Esc/Space/z/Del keys (R14.1–R14.5). */}
      {triageIds !== null && (
        <TriagePanel
          ids={triageIds}
          items={items}
          onApply={update}
          onClose={() => setTriageIds(null)}
        />
      )}

      {/* Up Next: the centerpiece ranked queue. Rendered from `bucketQueue(items,
          'next')` (all next items — hideRead is a Shelf concern, not applied
          here) in the existing Row style with rank number, read-dot, title,
          length/time labels, and the ⠿ handle (R15.1). Dragging ranks only
          within Up Next via reorderWithinBucket (R15.2); row #1 gets subtle
          `border-primary/40` emphasis. Row hover actions: "↓ Shelf" moves the
          item to the shelf bucket (R15.3) and ✕ removes it. When the queue is
          empty an empty-state prompt is shown (R15.4). */}
      <section className="rounded-lg border border-border/30 p-2">
        <h2 className="px-1.5 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          Up Next<span className="text-muted-foreground/50">{nextCount || ''}</span>
        </h2>
        {nextItems.length === 0 ? (
          <p className="px-1.5 py-2 text-xs text-muted-foreground/60">
            Nothing queued — promote something from the shelf below.
          </p>
        ) : (
          <ul className="space-y-1">
            {nextItems.map((it, idx) => (
              <Row
                key={it.id}
                it={it}
                idx={idx}
                emphasize={idx === 0}
                isOver={overId === it.id}
                isDragging={dragId === it.id}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragEnterRow={onDragEnterRow}
                onDropRow={onDropRow}
                onToggleRead={onToggleRead}
                onRemove={onRemoveCb}
                onMoveToShelf={onMoveToShelf}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Shelf: one flat list of readables parked for later (R16). Selected via
          `bucketQueue(items, 'shelf')` and re-sorted by `addedAt` descending for
          display (R16.1). Filter chips apply a client-side `kind` filter with
          "All" default (R16.2); the search box filters titles case-insensitively
          (R16.3). "Hide read" (header checkbox) excludes read items (R16.5).
          Rows have no dragging; each offers "↑ Up next" (moveToBucket → back of
          `next`, R16.4) and ✕. Past 30 filtered rows the first 30 show with a
          "Show all {n}" expander (R16.6). */}
      <section className="rounded-lg border border-border/30 p-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2 px-1.5 py-1">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            Shelf<span className="text-muted-foreground/50">{shelfFiltered.length || ''}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-1">
            {SHELF_FILTERS.map((f) => {
              const active = shelfFilter === f.kind;
              return (
                <button
                  key={f.label}
                  onClick={() => { setShelfFilter(f.kind); setShelfShowAll(false); }}
                  className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                    active
                      ? 'border-primary/50 bg-muted text-foreground'
                      : 'border-border/50 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <input
            value={shelfSearch}
            onChange={(e) => { setShelfSearch(e.target.value); setShelfShowAll(false); }}
            placeholder="Search titles"
            className="ml-auto w-40 rounded-md border border-border/40 bg-muted/30 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        {shelfFiltered.length === 0 ? (
          <p className="px-1.5 py-2 text-xs text-muted-foreground/50">nothing here</p>
        ) : (
          <>
            <ul className="space-y-1">
              {shelfShown.map((it) => (
                <ShelfRow
                  key={it.id}
                  it={it}
                  onToggleRead={onToggleRead}
                  onMoveToNext={onMoveToNext}
                  onRemove={onRemoveCb}
                />
              ))}
            </ul>
            {shelfFiltered.length > SHELF_PAGE && (
              <button
                onClick={() => setShelfShowAll((v) => !v)}
                className="px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {shelfShowAll ? 'Show fewer' : `Show all ${shelfFiltered.length}`}
              </button>
            )}
          </>
        )}
      </section>

      {/* Topics: reference terms as a collapsed chip strip (R17). Rendered only
          when there are topic items. The header toggles the section open/closed
          (collapsed by default, R17.1). Expanded, it shows wrapped small chips —
          each chip is the item title plus a ✕ that dismisses it (R17.2). There
          are no queues, ranking, or read-dots here (R17.3). */}
      {topicItems.length > 0 && (
        <section className="rounded-lg border border-border/30 p-2">
          <button
            onClick={() => setTopicsOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-1.5 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            <span className="text-muted-foreground/50">{topicsOpen ? '▾' : '▸'}</span>
            Topics<span className="text-muted-foreground/50">· {topicItems.length}</span>
          </button>
          {topicsOpen && (
            <div className="flex flex-wrap gap-1.5 px-1.5 py-2">
              {topicItems.map((it) => (
                <span
                  key={it.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/50 bg-card text-xs"
                >
                  <span className="truncate max-w-[16rem]">{it.title}</span>
                  <button
                    onClick={() => dismissIds([it.id])}
                    className="text-muted-foreground/60 hover:text-red-400"
                    title="Dismiss"
                  >✕</button>
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Finished: a collapsed record of read readables (R18). Rendered only when
          there are finished items. The header toggles the section open/closed
          (collapsed by default, R18.1). Expanded, it lists each finished item's
          title + kind; clicking the read-dot un-reads it via setRead(id, false)
          so it drops back out of this record (R18.2). No queues or ranking. */}
      {finishedItems.length > 0 && (
        <section className="rounded-lg border border-border/30 p-2">
          <button
            onClick={() => setFinishedOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-1.5 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            <span className="text-muted-foreground/50">{finishedOpen ? '▾' : '▸'}</span>
            Finished<span className="text-muted-foreground/50">· {finishedItems.length}</span>
          </button>
          {finishedOpen && (
            <ul className="space-y-1 px-1.5 py-2">
              {finishedItems.map((it) => (
                <li
                  key={it.id}
                  className="group flex items-center gap-3 rounded-md border border-border/40 bg-card px-2.5 py-2 text-sm select-text"
                >
                  <button
                    onClick={() => onUnread(it.id)}
                    title="Read — click to unmark"
                    className="h-3 w-3 shrink-0 rounded-full border bg-amber-400 border-amber-400"
                  />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{it.title}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/50">{it.kind}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** Readable-kind sub-picker for the "Read it" outcome: label + keyboard keys. */
const READ_KINDS: { kind: ItemKind; label: string; key: string; num: string }[] = [
  { kind: 'article', label: 'Article', key: 'a', num: '1' },
  { kind: 'sep', label: 'SEP', key: 's', num: '2' },
  { kind: 'book', label: 'Book', key: 'b', num: '3' },
  { kind: 'paper', label: 'Paper', key: 'p', num: '4' },
];

/**
 * One-at-a-time triage modal (R14). The reader sorts each captured link into one
 * of three outcomes:
 *   - "Read it" reveals four readable-kind sub-buttons (Article/SEP/Book/Paper,
 *     keys a/s/b/p or 1–4) → `fileItem(items, id, kind, 'shelf')` (R14.2).
 *   - "Topic" → `fileItem(items, id, 'concept', 'topic')` in one tap (R14.3).
 *   - "Dismiss" → `dismissItem(items, id)` (R14.4).
 * Keyboard: Space / ArrowRight skips without filing, z undoes the last action via
 * snapshot restore, Esc backs out of the sub-picker or closes the panel, and
 * Del / Backspace dismisses (R14.5). Every filing/dismiss/skip pushes a snapshot
 * so it can be undone in order. After the last item the panel closes.
 */
function TriagePanel({ ids, items, onApply, onClose }: {
  ids: string[];
  items: ReadingItem[];
  onApply: (next: ReadingItem[]) => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  // When true, the "Read it" readable-kind sub-picker is shown for this item.
  const [picking, setPicking] = useState(false);
  const history = useRef<{ snapshot: ReadingItem[]; i: number }[]>([]);
  const id = ids[i];
  const item = items.find((x) => x.id === id);

  const advance = useCallback(() => {
    setPicking(false);
    if (i + 1 >= ids.length) onClose();
    else setI(i + 1);
  }, [i, ids.length, onClose]);

  // Each action records a snapshot (list + index) so it can be undone in order.
  const fileRead = useCallback((kind: ItemKind) => {
    history.current.push({ snapshot: items, i });
    if (id) onApply(fileItem(items, id, kind, 'shelf'));
    advance();
  }, [items, i, id, onApply, advance]);

  const fileTopic = useCallback(() => {
    history.current.push({ snapshot: items, i });
    if (id) onApply(fileItem(items, id, 'concept', 'topic'));
    advance();
  }, [items, i, id, onApply, advance]);

  const dismiss = useCallback(() => {
    history.current.push({ snapshot: items, i });
    if (id) onApply(dismissItem(items, id));
    advance();
  }, [items, i, id, onApply, advance]);

  const skip = useCallback(() => {
    history.current.push({ snapshot: items, i });
    advance();
  }, [items, i, advance]);

  const undo = useCallback(() => {
    const h = history.current.pop();
    if (!h) return;
    onApply(h.snapshot);
    setI(h.i);
    setPicking(false);
  }, [onApply]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // Esc backs out of the sub-picker first, otherwise closes the panel.
        if (picking) setPicking(false); else onClose();
        return;
      }
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); skip(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); dismiss(); return; }
      if (picking) {
        const match = READ_KINDS.find((k) => k.key === e.key.toLowerCase() || k.num === e.key);
        if (match) { e.preventDefault(); fileRead(match.kind); }
        return;
      }
      // Top-level outcome keys: r = Read it, t = Topic, d = Dismiss.
      const k = e.key.toLowerCase();
      if (k === 'r') { e.preventDefault(); setPicking(true); }
      else if (k === 't') { e.preventDefault(); fileTopic(); }
      else if (k === 'd') { e.preventDefault(); dismiss(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking, fileRead, fileTopic, dismiss, skip, undo, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Sorting · {Math.min(i + 1, ids.length)} / {ids.length}</span>
          <div className="flex items-center gap-3">
            <button onClick={undo} disabled={history.current.length === 0} className="hover:text-foreground disabled:opacity-30">Undo (z)</button>
            <button onClick={onClose} className="hover:text-foreground">Done (Esc)</button>
          </div>
        </div>

        <div className="my-5 text-center">
          <div className="text-lg font-medium break-words">{item ? item.title : '—'}</div>
          {item && (lengthLabel(item) || timeLabel(item)) && (
            <div className="mt-1 text-xs text-muted-foreground">{[lengthLabel(item), timeLabel(item)].filter(Boolean).join(' · ')}</div>
          )}
        </div>

        {!picking ? (
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setPicking(true)}
              className="flex flex-col items-center gap-0.5 rounded-md border border-border/60 bg-muted/20 px-2.5 py-3 text-sm hover:bg-muted hover:border-primary/50 transition-colors"
            >
              <span>Read it</span>
              <span className="text-[10px] text-muted-foreground/70">(r)</span>
            </button>
            <button
              onClick={fileTopic}
              className="flex flex-col items-center gap-0.5 rounded-md border border-border/60 bg-muted/20 px-2.5 py-3 text-sm hover:bg-muted hover:border-primary/50 transition-colors"
            >
              <span>Topic</span>
              <span className="text-[10px] text-muted-foreground/70">(t)</span>
            </button>
            <button
              onClick={dismiss}
              className="flex flex-col items-center gap-0.5 rounded-md border border-border/60 bg-muted/20 px-2.5 py-3 text-sm hover:bg-muted hover:border-red-400/50 transition-colors"
            >
              <span>Dismiss</span>
              <span className="text-[10px] text-muted-foreground/70">(d)</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-center text-xs text-muted-foreground">Read it as…</div>
            <div className="grid grid-cols-4 gap-2">
              {READ_KINDS.map((k) => (
                <button
                  key={k.kind}
                  onClick={() => fileRead(k.kind)}
                  className="flex flex-col items-center gap-0.5 rounded-md border border-border/60 bg-muted/20 px-2 py-3 text-sm hover:bg-muted hover:border-primary/50 transition-colors"
                >
                  <span className="truncate">{k.label}</span>
                  <span className="text-[10px] text-muted-foreground/70">({k.key})</span>
                </button>
              ))}
            </div>
            <div className="text-center">
              <button onClick={() => setPicking(false)} className="text-xs text-muted-foreground hover:text-foreground">← back</button>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs">
          <button onClick={dismiss} className="text-muted-foreground hover:text-red-400">Dismiss (Del)</button>
          <button onClick={skip} className="rounded-md border border-border/60 px-3 py-1.5 hover:bg-muted">Skip (Space) →</button>
        </div>
      </div>
    </div>
  );
}

/**
 * "+ Add" form for creating a manual reading item. The kind selector offers only
 * READABLE_KINDS (Article/SEP/Book/Paper). The item is created here with a
 * unique id, `source: 'manual'`, `read: false`, and `addedAt` now; its `bucket`
 * (`shelf`) and back-of-shelf `order` are assigned by the parent's `onAdd`
 * (R12.3, R12.4).
 */
function AddForm({ onAdd, onCancel }: { onAdd: (item: ReadingItem) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ItemKind>('article');
  const [pages, setPages] = useState('');

  const submit = () => {
    if (!title.trim()) return;
    const p = Number.parseInt(pages, 10);
    const pagesVal = Number.isFinite(p) && p > 0 ? p : undefined;
    onAdd({
      id: `manual-${Date.now()}`,
      title: title.trim(),
      kind,
      bucket: 'shelf',
      source: 'manual',
      pages: pagesVal,
      estMinutes: estimateMinutes(undefined, pagesVal),
      read: false,
      order: 0,
      addedAt: Date.now(),
    });
  };

  return (
    <div className="rounded-lg border border-border/50 bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
          placeholder="Title"
          className="flex-1 min-w-[200px] rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ItemKind)}
          className="rounded-md border border-border/40 bg-muted/30 px-2 py-2 text-sm"
        >
          {READABLE_KINDS.map((k) => (
            <option key={k} value={k}>{READABLE_KIND_LABELS[k] ?? k}</option>
          ))}
        </select>
        <input
          value={pages}
          onChange={(e) => setPages(e.target.value)}
          placeholder="pages"
          inputMode="numeric"
          className="w-24 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
        <button onClick={submit} disabled={!title.trim()} className="rounded-md border border-border/60 bg-muted/40 px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40">Add</button>
      </div>
    </div>
  );
}
