'use client';

/**
 * Reading list / ranking.
 * Feature: ranking-page-redesign
 *
 * Bucket-first: every item lives in exactly one BUCKET (`inbox`, `next`,
 * `shelf`, `topic`, `dismissed`) describing where it sits in the reading flow;
 * its `kind` (article, book, person, …) is just a metadata label. Captured
 * links land in the inbox; the reader files them by hand — no AI guesses.
 *
 * Length + estimated time ride along on each item. "Read" is a manual marker;
 * marking a `next` item read also self-cleans it onto the shelf.
 *
 * localStorage-backed (v3 key, with one-shot v2 migration); the pure helpers
 * are unit- and property-tested.
 */

export type ItemKind =
  | 'unsorted'
  | 'article'
  | 'sep'
  | 'book'
  | 'paper'
  | 'person'
  | 'event'
  | 'place'
  | 'organization'
  | 'concept'
  | 'religion'
  | 'period'
  | 'technology';

/**
 * The organizing dimension of a ReadingItem — where it sits in the reading flow.
 * Buckets are the layout; `kind` (ItemKind) is demoted to a metadata label.
 *  - `inbox`     — freshly captured, un-triaged links (one collapsed line)
 *  - `next`      — the ranked reading queue, the centerpiece (drag-rankable)
 *  - `shelf`     — readables parked for later (flat filterable list)
 *  - `topic`     — reference terms / entities (chip strip)
 *  - `dismissed` — tombstones, retained so re-seeding cannot resurrect them;
 *                  never rendered
 */
export type Bucket = 'inbox' | 'next' | 'shelf' | 'topic' | 'dismissed';

/** Readable kinds — the type sub-picker for triage/add offers only these. */
export const READABLE_KINDS: ItemKind[] = ['article', 'sep', 'book', 'paper'];

/** Topic kinds — every kind except `unsorted` and the readable kinds. */
export const TOPIC_KINDS: ItemKind[] = [
  'person',
  'event',
  'place',
  'organization',
  'concept',
  'religion',
  'period',
  'technology',
];

export interface ReadingItem {
  id: string;
  title: string;
  /** Reference label / metadata — no longer determines any page section. */
  kind: ItemKind;
  /** The organizing dimension — which bucket this item lives in. */
  bucket: Bucket;
  /** Where it came from. */
  source: 'article' | 'pdf' | 'epub' | 'link' | 'manual';
  words?: number;
  pages?: number;
  estMinutes?: number;
  /** Manual read marker (never inferred). */
  read: boolean;
  /**
   * Rank WITHIN its bucket (lower = sooner). Invariant: within any bucket that
   * contains items, `order` values are unique and contiguous from `0` to `n-1`
   * (no gaps, no duplicates) after any reorder, move, or file operation.
   * `order` is only meaningful for ranking the `next` bucket; other buckets
   * carry it to preserve the invariant but do not rank by it (e.g. the shelf
   * sorts by `addedAt`).
   */
  order: number;
  addedAt: number;
}

const WORDS_PER_MIN = 220;
const MIN_PER_PAGE = 1.8;
const V2_KEY = 'reading-list:v2';
const V3_KEY = 'reading-list:v3';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function wordCount(text: string): number {
  return (text.replace(/<[^>]+>/g, ' ').match(/\S+/g) ?? []).length;
}

export function estimateMinutes(words?: number, pages?: number): number | undefined {
  if (words && words > 0) return Math.max(1, Math.round(words / WORDS_PER_MIN));
  if (pages && pages > 0) return Math.max(1, Math.round(pages * MIN_PER_PAGE));
  return undefined;
}

export function lengthLabel(item: ReadingItem): string {
  if (item.words && item.words > 0) return `~${item.words.toLocaleString()} words`;
  if (item.pages && item.pages > 0) return `~${item.pages} pages`;
  return '';
}

/**
 * Format a raw minute count into a compact human label — the same shape as
 * `timeLabel` but WITHOUT the leading `~` (e.g. `40 min`, `2 h 10 m`, `2 h`).
 * Total, deterministic, and side-effect-free; precondition `m >= 0`.
 */
export function formatMinutes(m: number): string {
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} m` : `${h} h`;
}

/**
 * Approximate reading-time label for an item (e.g. `~40 min`, `~2 h 10 m`).
 * Returns '' when `estMinutes` is missing or non-positive; otherwise delegates
 * the number formatting to `formatMinutes` and prefixes the `~`.
 */
export function timeLabel(item: ReadingItem): string {
  const m = item.estMinutes;
  if (!m || m <= 0) return '';
  return `~${formatMinutes(m)}`;
}

// ── Persistence ──────────────────────────────────────────────────────────────

/** A pre-migration (v2) item carries no `bucket` — everything else is identical. */
type V2Item = Omit<ReadingItem, 'bucket'>;

/**
 * Map one legacy v2 item onto a bucket, preserving every other field:
 *  - `unsorted`            → `inbox`
 *  - kind in READABLE_KINDS → `shelf`
 *  - kind in TOPIC_KINDS    → `topic`
 */
function migrateV2Item(item: V2Item): ReadingItem {
  let bucket: Bucket;
  if (item.kind === 'unsorted') {
    bucket = 'inbox';
  } else if (READABLE_KINDS.includes(item.kind)) {
    bucket = 'shelf';
  } else {
    bucket = 'topic'; // TOPIC_KINDS
  }
  return { ...item, bucket };
}

export function loadReadingList(): ReadingItem[] {
  if (!hasStorage()) return [];
  try {
    // Prefer v3 when present.
    const rawV3 = window.localStorage.getItem(V3_KEY);
    if (rawV3) {
      const parsed = JSON.parse(rawV3);
      return Array.isArray(parsed) ? (parsed as ReadingItem[]) : [];
    }

    // No v3 yet — migrate from v2 once. On a fresh browser both keys are absent,
    // so this read is null; guard it so we never crash and return [].
    const rawV2 = window.localStorage.getItem(V2_KEY);
    if (!rawV2) return [];

    const parsedV2 = JSON.parse(rawV2);
    if (!Array.isArray(parsedV2)) return [];

    const migrated = (parsedV2 as V2Item[]).map(migrateV2Item);
    // Persist the migrated list to v3 and drop the legacy key.
    try {
      window.localStorage.setItem(V3_KEY, JSON.stringify(migrated));
      window.localStorage.removeItem(V2_KEY);
    } catch {
      /* quota / write failure — keep the migrated list in memory for the session */
    }
    return migrated;
  } catch {
    return [];
  }
}

export function saveReadingList(items: ReadingItem[]): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(V3_KEY, JSON.stringify(items));
  } catch {
    /* quota */
  }
}

// ── Pure operations ──────────────────────────────────────────────────────────

/**
 * A bucket's renderable items, in rank order.
 *
 * Returns only the items whose `bucket` equals the argument, sorted ascending by
 * `order`. `dismissed` items are tombstones and are never rendered, so they are
 * always excluded — which also means calling this with the `dismissed` bucket
 * yields an empty list (R4.1, R4.2, R4.3).
 */
export function bucketQueue(items: ReadingItem[], bucket: Bucket): ReadingItem[] {
  if (bucket === 'dismissed') return [];
  return items
    .filter((i) => i.bucket === bucket)
    .sort((a, b) => a.order - b.order);
}

/**
 * Reorder within a bucket: move `draggedId` into `targetId`'s slot (both must be
 * in the same bucket) and renumber that bucket `0..n-1`.
 *
 * Returns the SAME array reference unchanged (so callers can identity-compare) as
 * a no-op when `draggedId === targetId`, when either id is absent from the list,
 * or when the two items are in different buckets (R5.2, R5.3, R5.4). Only the
 * affected bucket is renumbered, keeping its `order` contiguous (R5.1, R1.6).
 */
export function reorderWithinBucket(items: ReadingItem[], draggedId: string, targetId: string): ReadingItem[] {
  if (draggedId === targetId) return items;
  const dragged = items.find((i) => i.id === draggedId);
  const target = items.find((i) => i.id === targetId);
  if (!dragged || !target || dragged.bucket !== target.bucket) return items;
  const q = bucketQueue(items, dragged.bucket);
  const from = q.findIndex((i) => i.id === draggedId);
  const to = q.findIndex((i) => i.id === targetId);
  // Both ids share a bucket that `bucketQueue` excludes (e.g. `dismissed`): no-op.
  if (from === -1 || to === -1) return items;
  const [moved] = q.splice(from, 1);
  q.splice(to, 0, moved);
  const orderById = new Map(q.map((i, idx) => [i.id, idx]));
  return items.map((i) => (orderById.has(i.id) ? { ...i, order: orderById.get(i.id)! } : i));
}

/**
 * Move an item into a different bucket.
 *
 * By default the item is set to the target `bucket` and appended to the BACK of
 * that bucket's `order` sequence (R6.1). Exception: `moveToBucket(items, id,
 * 'next', { position: 'top' })` inserts the item at `order` `0` of the `next`
 * bucket and renumbers `next` (R6.2); `position: 'top'` is honored only for the
 * `next` bucket, otherwise the item goes to the back.
 *
 * In all cases the SOURCE bucket is renumbered `0..n-1` after the item leaves it,
 * so both the source and target buckets stay contiguous (Property 1 / R1.6).
 *
 * Returns the SAME array reference unchanged as a no-op when `id` is absent from
 * the list (R6.3).
 */
export function moveToBucket(
  items: ReadingItem[],
  id: string,
  bucket: Bucket,
  opts?: { position?: 'top' | 'back' },
): ReadingItem[] {
  const item = items.find((i) => i.id === id);
  if (!item) return items;

  const source = item.bucket;
  const toTop = opts?.position === 'top' && bucket === 'next';
  const moved: ReadingItem = { ...item, bucket };

  // Order the TARGET bucket with the moved item inserted (top for next/top,
  // otherwise the back), then assign contiguous `0..n-1`.
  const targetExisting = items
    .filter((i) => i.bucket === bucket && i.id !== id)
    .sort((a, b) => a.order - b.order);
  const targetOrdered = toTop ? [moved, ...targetExisting] : [...targetExisting, moved];
  const targetOrderById = new Map(targetOrdered.map((i, idx) => [i.id, idx]));

  // Renumber the SOURCE bucket `0..n-1` after the item leaves it (only when the
  // source and target differ — a same-bucket move is handled by the target pass).
  const sourceOrderById = new Map<string, number>();
  if (source !== bucket) {
    items
      .filter((i) => i.bucket === source && i.id !== id)
      .sort((a, b) => a.order - b.order)
      .forEach((i, idx) => sourceOrderById.set(i.id, idx));
  }

  return items.map((i) => {
    if (i.id === id) return { ...moved, order: targetOrderById.get(id)! };
    if (i.bucket === bucket && targetOrderById.has(i.id)) return { ...i, order: targetOrderById.get(i.id)! };
    if (source !== bucket && sourceOrderById.has(i.id)) return { ...i, order: sourceOrderById.get(i.id)! };
    return i;
  });
}

/**
 * File an item: set BOTH its `kind` and `bucket` and drop it at the BACK of the
 * target bucket's `order` sequence (used for triage out of the inbox).
 *
 * Like `moveToBucket`, the SOURCE bucket is renumbered `0..n-1` after the item
 * leaves it, so both the source and target buckets stay contiguous
 * (Property 1 / R1.6, R7.1).
 *
 * Returns the SAME array reference unchanged as a no-op when `id` is absent from
 * the list (R7.2).
 */
export function fileItem(items: ReadingItem[], id: string, kind: ItemKind, bucket: Bucket): ReadingItem[] {
  const item = items.find((i) => i.id === id);
  if (!item) return items;

  const source = item.bucket;
  const moved: ReadingItem = { ...item, kind, bucket };

  // Order the TARGET bucket with the moved item appended to the back, then
  // assign contiguous `0..n-1`.
  const targetOrdered = [
    ...items.filter((i) => i.bucket === bucket && i.id !== id).sort((a, b) => a.order - b.order),
    moved,
  ];
  const targetOrderById = new Map(targetOrdered.map((i, idx) => [i.id, idx]));

  // Renumber the SOURCE bucket `0..n-1` after the item leaves it (only when the
  // source and target differ — a same-bucket file is handled by the target pass).
  const sourceOrderById = new Map<string, number>();
  if (source !== bucket) {
    items
      .filter((i) => i.bucket === source && i.id !== id)
      .sort((a, b) => a.order - b.order)
      .forEach((i, idx) => sourceOrderById.set(i.id, idx));
  }

  return items.map((i) => {
    if (i.id === id) return { ...moved, order: targetOrderById.get(id)! };
    if (i.bucket === bucket && targetOrderById.has(i.id)) return { ...i, order: targetOrderById.get(i.id)! };
    if (source !== bucket && sourceOrderById.has(i.id)) return { ...i, order: sourceOrderById.get(i.id)! };
    return i;
  });
}

/**
 * Flip an item's manual `read` marker.
 *
 * Special case — Up Next self-clean (R8.2): when `read` is `true` AND the item's
 * bucket is `next`, the item is also moved to the `shelf` bucket (keeping its
 * `kind` and the `read` flag) so the ranked queue stays focused on what remains.
 * The move delegates to `moveToBucket`, which renumbers both the source `next`
 * bucket and the target `shelf` bucket `0..n-1`, then the `read` flag is set.
 *
 * In every other bucket only the `read` flag changes; the bucket is untouched
 * (R8.1, R8.3).
 *
 * Returns the SAME array reference unchanged as a no-op when `id` is absent from
 * the list (R8.4).
 */
export function setRead(items: ReadingItem[], id: string, read: boolean): ReadingItem[] {
  const item = items.find((i) => i.id === id);
  if (!item) return items;

  if (read && item.bucket === 'next') {
    const moved = moveToBucket(items, id, 'shelf');
    return moved.map((i) => (i.id === id ? { ...i, read } : i));
  }

  return items.map((i) => (i.id === id ? { ...i, read } : i));
}

/**
 * Dismiss an item: set its `bucket` to `dismissed`, turning it into a tombstone
 * that is never rendered and that reconciliation preserves so a later re-capture
 * cannot resurrect it (R9.1). Only the `bucket` changes — `kind`, `order`, and
 * every other field are retained on the tombstone.
 *
 * Returns the SAME array reference unchanged as a no-op when `id` is absent from
 * the list (R9.3).
 */
export function dismissItem(items: ReadingItem[], id: string): ReadingItem[] {
  if (!items.some((i) => i.id === id)) return items;
  return items.map((i) => (i.id === id ? { ...i, bucket: 'dismissed' } : i));
}

/**
 * Remove an item entirely: filter it out of the list (a hard delete, used for
 * manual items that carry no tombstone) (R9.2).
 *
 * Returns the SAME array reference unchanged as a no-op when `id` is absent from
 * the list, so callers can identity-compare (R9.3).
 */
export function removeItem(items: ReadingItem[], id: string): ReadingItem[] {
  if (!items.some((i) => i.id === id)) return items;
  return items.filter((i) => i.id !== id);
}

/**
 * Estimated reading time still ahead: the sum of `estMinutes` over exactly the
 * items whose bucket is `next` and whose `read` flag is false (R10.1). Every
 * other bucket (R10.2) and every read item (R10.3) is excluded, and a missing
 * `estMinutes` contributes `0`.
 */
export function totalMinutes(items: ReadingItem[]): number {
  return items.reduce(
    (sum, i) => (i.bucket === 'next' && !i.read ? sum + (i.estMinutes ?? 0) : sum),
    0,
  );
}

/**
 * A read-only seed input derived from a seed source. Carries `id`, `title`,
 * `kind`, `bucket`, and `source`, plus the optional length fields; `read`,
 * `order`, and `addedAt` are assigned by reconciliation, not by the source.
 *  - Article_Library_Seed → `source: 'article'`, default bucket `shelf`
 *  - Captured_Link_Seed    → `source: 'link'`,  `kind: 'unsorted'`, default bucket `inbox`
 */
export type Seed = Omit<ReadingItem, 'order' | 'addedAt' | 'read'>;

/**
 * Reconcile seeded items (from articles + captured links) against the current
 * reading data — bucket-aware — while preserving everything the reader filed by
 * hand and never resurrecting a dismissed tombstone:
 *  - an existing item matching a seed id keeps its `bucket`/`kind`/`order`/`read`
 *    and refreshes only `title`/`words`/`pages`/`estMinutes` (R3.1),
 *  - an existing item whose bucket is `dismissed` stays `dismissed` even when a
 *    matching seed reappears — tombstones are never dropped, so a later
 *    re-capture cannot resurrect them (R3.2, R3.3),
 *  - a non-dismissed item with `source` `article` or `link` and no matching seed
 *    is dropped as an orphan (R3.3),
 *  - a Manual_Item (source neither `article` nor `link`) with no matching seed
 *    is always kept (R3.4),
 *  - a genuinely new seed is appended to the back of the `order` sequence of its
 *    default bucket with `read: false` (R3.5, R3.6).
 */
export function reconcileSeeds(items: ReadingItem[], seeds: Seed[]): ReadingItem[] {
  const seedById = new Map(seeds.map((s) => [s.id, s]));
  const kept: ReadingItem[] = [];

  for (const it of items) {
    const s = seedById.get(it.id);
    if (s) {
      // Existing item matching a seed: keep the reader's bucket/kind/order/read
      // (spreading `...it` preserves a `dismissed` bucket too), refresh only the
      // surface fields.
      kept.push({
        ...it,
        title: s.title,
        words: s.words ?? it.words,
        pages: s.pages ?? it.pages,
        estMinutes: s.estMinutes ?? it.estMinutes,
      });
      seedById.delete(it.id);
    } else if (it.bucket === 'dismissed') {
      kept.push(it); // tombstone stays dismissed — the whole point
    } else if (it.source === 'article' || it.source === 'link') {
      // Orphaned seed (deleted / retargeted upstream) — drop it.
    } else {
      kept.push(it); // manual / other — always keep
    }
  }

  // Genuinely new seeds append to the BACK of their default bucket's order.
  const orderByBucket = new Map<Bucket, number>();
  for (const i of kept) orderByBucket.set(i.bucket, Math.max(orderByBucket.get(i.bucket) ?? -1, i.order));
  for (const s of seedById.values()) {
    const order = (orderByBucket.get(s.bucket) ?? -1) + 1;
    orderByBucket.set(s.bucket, order);
    kept.push({ ...s, read: false, order, addedAt: Date.now() });
  }
  return kept;
}
