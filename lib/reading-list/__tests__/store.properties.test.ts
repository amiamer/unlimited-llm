/**
 * Property-Based Tests for the reading-list store helpers.
 * Feature: ranking-page-redesign
 *
 * These properties target the pure Reading_List_Store helpers in
 * `lib/reading-list/store.ts`. The v2→v3 migration is exercised end-to-end via
 * `loadReadingList()` after seeding a `reading-list:v2` payload into a
 * localStorage mock (the test env is `node`, so `window` is stubbed).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  loadReadingList,
  reconcileSeeds,
  bucketQueue,
  moveToBucket,
  reorderWithinBucket,
  fileItem,
  setRead,
  dismissItem,
  removeItem,
  totalMinutes,
  formatMinutes,
  READABLE_KINDS,
  TOPIC_KINDS,
  type ItemKind,
  type Bucket,
  type ReadingItem,
  type Seed,
} from '../store';

const V2_KEY = 'reading-list:v2';
const V3_KEY = 'reading-list:v3';

/** A pre-migration (v2) item carries no `bucket` — everything else is identical. */
type V2Item = Omit<ReadingItem, 'bucket'>;

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

const ALL_KINDS: ItemKind[] = ['unsorted', ...READABLE_KINDS, ...TOPIC_KINDS];
const SOURCES: ReadingItem['source'][] = ['article', 'pdf', 'epub', 'link', 'manual'];

/** The oracle bucket mapping, mirroring the migration contract (R2.3–R2.5). */
function expectedBucket(kind: ItemKind): Bucket {
  if (kind === 'unsorted') return 'inbox';
  if (READABLE_KINDS.includes(kind)) return 'shelf';
  return 'topic'; // TOPIC_KINDS
}

/** fast-check arbitrary for a legacy v2 item (no `bucket`), spanning all kinds. */
const v2ItemArb: fc.Arbitrary<V2Item> = fc.record({
  id: fc.uuid(),
  title: fc.string(),
  kind: fc.constantFrom(...ALL_KINDS),
  source: fc.constantFrom(...SOURCES),
  words: fc.option(fc.nat({ max: 200000 }), { nil: undefined }),
  pages: fc.option(fc.nat({ max: 5000 }), { nil: undefined }),
  estMinutes: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
  read: fc.boolean(),
  order: fc.nat({ max: 1000 }),
  addedAt: fc.nat({ max: 2_000_000_000_000 }),
});

describe('reading-list store — property tests', () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  // Feature: ranking-page-redesign, Property 3: Migration maps buckets and
  // preserves everything else.
  it('Property 3: migration maps buckets by kind and preserves every other field', () => {
    fc.assert(
      fc.property(fc.array(v2ItemArb, { maxLength: 40 }), (v2Items) => {
        installLocalStorageMock(); // fresh store per run
        // Seed a v2 payload with NO v3 present, so loadReadingList migrates.
        window.localStorage.setItem(V2_KEY, JSON.stringify(v2Items));

        const migrated = loadReadingList();

        // Same item count (R2.7).
        expect(migrated).toHaveLength(v2Items.length);

        migrated.forEach((out, i) => {
          const src = v2Items[i];
          // Bucket assigned by kind (R2.3, R2.4, R2.5).
          expect(out.bucket).toBe(expectedBucket(src.kind));
          // Every other field preserved unchanged (R2.6). `===` treats a
          // dropped optional (undefined) and an absent JSON key alike.
          expect(out.id).toBe(src.id);
          expect(out.title).toBe(src.title);
          expect(out.kind).toBe(src.kind);
          expect(out.source).toBe(src.source);
          expect(out.words).toBe(src.words);
          expect(out.pages).toBe(src.pages);
          expect(out.estMinutes).toBe(src.estMinutes);
          expect(out.read).toBe(src.read);
          expect(out.order).toBe(src.order);
          expect(out.addedAt).toBe(src.addedAt);
        });
      }),
      { numRuns: 200 },
    );
  });
});

describe('reading-list store — reconcileSeeds tombstone survival', () => {
  // A spec for a ReadingItem WITHOUT its id — the id is assigned by index in the
  // scenario builder so every generated item has a unique id.
  const itemSpecArb = fc.record({
    title: fc.string(),
    kind: fc.constantFrom(...ALL_KINDS),
    bucket: fc.constantFrom<Bucket>('inbox', 'next', 'shelf', 'topic', 'dismissed'),
    source: fc.constantFrom(...SOURCES),
    words: fc.option(fc.nat({ max: 200000 }), { nil: undefined }),
    pages: fc.option(fc.nat({ max: 5000 }), { nil: undefined }),
    estMinutes: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
    read: fc.boolean(),
    order: fc.nat({ max: 1000 }),
    addedAt: fc.nat({ max: 2_000_000_000_000 }),
  });

  // A seed spec whose id is resolved (in the scenario builder) to either an
  // existing tombstone id, an existing non-dismissed id, or a fresh id — so the
  // generated seed set may (and often does) match the tombstone ids.
  const seedSpecArb = fc.record({
    target: fc.constantFrom('tombstone', 'other', 'fresh'),
    idx: fc.nat({ max: 1000 }),
    title: fc.string(),
    kind: fc.constantFrom(...ALL_KINDS),
    bucket: fc.constantFrom<Bucket>('inbox', 'next', 'shelf', 'topic', 'dismissed'),
    source: fc.constantFrom(...SOURCES),
    words: fc.option(fc.nat({ max: 200000 }), { nil: undefined }),
    pages: fc.option(fc.nat({ max: 5000 }), { nil: undefined }),
    estMinutes: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
  });

  // Build a concrete scenario: at least one dismissed tombstone, some other
  // items (any bucket), a seed set whose ids may match the tombstones, and a
  // rerun count 1..5 for repeated reconcile passes.
  const scenarioArb = fc
    .record({
      dismissed: fc.array(itemSpecArb, { minLength: 1, maxLength: 8 }),
      others: fc.array(itemSpecArb, { maxLength: 16 }),
      seedSpecs: fc.array(seedSpecArb, { maxLength: 16 }),
      reruns: fc.integer({ min: 1, max: 5 }),
    })
    .map(({ dismissed, others, seedSpecs, reruns }) => {
      // Dismissed tombstones — ids prefixed `d-`, bucket forced to `dismissed`.
      const dismissedItems: ReadingItem[] = dismissed.map((spec, i) => ({
        ...spec,
        id: `d-${i}`,
        bucket: 'dismissed' as Bucket,
      }));
      // Non-dismissed / other items — ids prefixed `o-` (kept distinct from d-).
      const otherItems: ReadingItem[] = others.map((spec, i) => ({
        ...spec,
        id: `o-${i}`,
      }));
      const items: ReadingItem[] = [...dismissedItems, ...otherItems];

      const seeds: Seed[] = seedSpecs.map((s, i) => {
        let id: string;
        if (s.target === 'tombstone') {
          // Match a tombstone id — the case that must NOT resurrect it.
          id = dismissedItems[s.idx % dismissedItems.length].id;
        } else if (s.target === 'other' && otherItems.length > 0) {
          id = otherItems[s.idx % otherItems.length].id;
        } else {
          id = `fresh-${i}`;
        }
        return {
          id,
          title: s.title,
          kind: s.kind,
          bucket: s.bucket,
          source: s.source,
          words: s.words,
          pages: s.pages,
          estMinutes: s.estMinutes,
        };
      });

      const tombstoneIds = dismissedItems.map((d) => d.id);
      return { items, seeds, reruns, tombstoneIds };
    });

  // Feature: ranking-page-redesign, Property 4: Dismissed tombstones survive any
  // number of reconcile passes.
  it('Property 4: every dismissed tombstone id survives N reconcile passes as bucket=dismissed', () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, seeds, reruns, tombstoneIds }) => {
        // Apply reconcileSeeds 1..N times, feeding the output back in each pass
        // while re-presenting the same seed set (seeds may match the tombstones).
        let current = items;
        for (let pass = 0; pass < reruns; pass++) {
          current = reconcileSeeds(current, seeds);
        }

        // Every originally-dismissed id is still present with bucket `dismissed`.
        for (const id of tombstoneIds) {
          const survivors = current.filter((it) => it.id === id);
          expect(survivors).toHaveLength(1);
          expect(survivors[0].bucket).toBe('dismissed');
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('reading-list store — reconcileSeeds match/drop/keep/append', () => {
  const optNat = (max: number) => fc.option(fc.nat({ max }), { nil: undefined });

  // An item spec plus a self-contained decision about whether a matching seed
  // exists for it and, if so, the surface fields that seed carries. The seed
  // also carries its OWN kind/bucket/source which must be IGNORED for a matched
  // item (the reader's bucket/kind/order/read win) — a deliberate probe of R3.1.
  const itemSpecArb = fc.record({
    title: fc.string(),
    kind: fc.constantFrom(...ALL_KINDS),
    bucket: fc.constantFrom<Bucket>('inbox', 'next', 'shelf', 'topic', 'dismissed'),
    source: fc.constantFrom(...SOURCES),
    words: optNat(200000),
    pages: optNat(5000),
    estMinutes: optNat(10000),
    read: fc.boolean(),
    order: fc.nat({ max: 1000 }),
    addedAt: fc.nat({ max: 2_000_000_000_000 }),
    hasSeed: fc.boolean(),
    seedTitle: fc.string(),
    seedWords: optNat(200000),
    seedPages: optNat(5000),
    seedEst: optNat(10000),
    seedKind: fc.constantFrom(...ALL_KINDS),
    seedBucket: fc.constantFrom<Bucket>('inbox', 'next', 'shelf', 'topic', 'dismissed'),
    seedSource: fc.constantFrom(...SOURCES),
  });

  // A genuinely-new seed with no matching item — its id is assigned in the
  // scenario builder (prefixed `new-`) so it can never collide with an item id.
  const freshSeedArb = fc.record({
    title: fc.string(),
    kind: fc.constantFrom(...ALL_KINDS),
    bucket: fc.constantFrom<Bucket>('inbox', 'next', 'shelf', 'topic', 'dismissed'),
    source: fc.constantFrom(...SOURCES),
    words: optNat(200000),
    pages: optNat(5000),
    estMinutes: optNat(10000),
  });

  // Build a concrete scenario: items with ids `i-{n}`, a seed set made of the
  // matching seeds (for items whose `hasSeed` is true, keyed to the item id) plus
  // the fresh seeds (ids `new-{n}`). We keep the raw item/seed specs around so the
  // assertions can compare against the exact inputs.
  const scenarioArb = fc
    .record({
      itemSpecs: fc.array(itemSpecArb, { maxLength: 30 }),
      freshSpecs: fc.array(freshSeedArb, { maxLength: 15 }),
    })
    .map(({ itemSpecs, freshSpecs }) => {
      const items: ReadingItem[] = itemSpecs.map((spec, i) => ({
        id: `i-${i}`,
        title: spec.title,
        kind: spec.kind,
        bucket: spec.bucket,
        source: spec.source,
        words: spec.words,
        pages: spec.pages,
        estMinutes: spec.estMinutes,
        read: spec.read,
        order: spec.order,
        addedAt: spec.addedAt,
      }));

      // Matching seeds — one per item whose `hasSeed` flag is set. The seed's own
      // kind/bucket/source are intentionally arbitrary to prove they are ignored.
      const matchedSeeds: Seed[] = itemSpecs
        .map((spec, i) => ({ spec, i }))
        .filter(({ spec }) => spec.hasSeed)
        .map(({ spec, i }) => ({
          id: `i-${i}`,
          title: spec.seedTitle,
          kind: spec.seedKind,
          bucket: spec.seedBucket,
          source: spec.seedSource,
          words: spec.seedWords,
          pages: spec.seedPages,
          estMinutes: spec.seedEst,
        }));

      const freshSeeds: Seed[] = freshSpecs.map((spec, i) => ({
        id: `new-${i}`,
        title: spec.title,
        kind: spec.kind,
        bucket: spec.bucket,
        source: spec.source,
        words: spec.words,
        pages: spec.pages,
        estMinutes: spec.estMinutes,
      }));

      return {
        items,
        itemSpecs,
        seeds: [...matchedSeeds, ...freshSeeds],
        freshSeeds,
      };
    });

  // Feature: ranking-page-redesign, Property 5: reconcileSeeds preserves matches,
  // drops orphans, keeps manual, appends new.
  // Validates: Requirements 3.1, 3.3, 3.4, 3.5
  it('Property 5: matched items keep bucket/kind/order/read & refresh surface; orphans drop; manual kept; new appended', () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, itemSpecs, seeds, freshSeeds }) => {
        const result = reconcileSeeds(items, seeds);
        const byId = new Map(result.map((r) => [r.id, r]));

        // ── Behavior over the original items ──────────────────────────────
        itemSpecs.forEach((spec, i) => {
          const id = `i-${i}`;
          const original = items[i];

          if (spec.hasSeed) {
            // R3.1 — a matched item keeps bucket/kind/order/read and refreshes
            // only title/words/pages/estMinutes (with `seed ?? existing`).
            const out = byId.get(id);
            expect(out).toBeDefined();
            expect(out!.bucket).toBe(original.bucket);
            expect(out!.kind).toBe(original.kind);
            expect(out!.order).toBe(original.order);
            expect(out!.read).toBe(original.read);
            expect(out!.title).toBe(spec.seedTitle);
            expect(out!.words).toBe(spec.seedWords ?? original.words);
            expect(out!.pages).toBe(spec.seedPages ?? original.pages);
            expect(out!.estMinutes).toBe(spec.seedEst ?? original.estMinutes);
          } else if (
            original.bucket !== 'dismissed' &&
            (original.source === 'article' || original.source === 'link')
          ) {
            // R3.3 — a non-dismissed article/link orphan (no matching seed) drops.
            expect(byId.has(id)).toBe(false);
          } else {
            // R3.4 — a manual item (or any non-article/link source), and any
            // dismissed tombstone, with no matching seed is kept unchanged.
            const out = byId.get(id);
            expect(out).toBeDefined();
            expect(out).toEqual(original);
          }
        });

        // ── New seeds append to the back of their default bucket ──────────
        // R3.5 — each genuinely new seed becomes an item with read=false whose
        // order sits strictly after the max order of pre-existing (kept) items
        // in that bucket.
        const newIds = new Set(freshSeeds.map((s) => s.id));
        const keptMaxByBucket = new Map<Bucket, number>();
        for (const r of result) {
          if (newIds.has(r.id)) continue;
          keptMaxByBucket.set(r.bucket, Math.max(keptMaxByBucket.get(r.bucket) ?? -1, r.order));
        }
        // Track appended orders per bucket to assert they don't collide.
        const appendedOrders = new Map<Bucket, Set<number>>();
        for (const seed of freshSeeds) {
          const out = byId.get(seed.id);
          expect(out).toBeDefined();
          expect(out!.read).toBe(false);
          expect(out!.bucket).toBe(seed.bucket);
          expect(out!.kind).toBe(seed.kind);
          expect(out!.title).toBe(seed.title);
          // Appended strictly after the current max order of its bucket.
          const keptMax = keptMaxByBucket.get(seed.bucket) ?? -1;
          expect(out!.order).toBeGreaterThan(keptMax);
          const seen = appendedOrders.get(seed.bucket) ?? new Set<number>();
          expect(seen.has(out!.order)).toBe(false); // distinct order per appended item
          seen.add(out!.order);
          appendedOrders.set(seed.bucket, seen);
        }
      }),
      { numRuns: 200 },
    );
  });
});

const ALL_BUCKETS: Bucket[] = ['inbox', 'next', 'shelf', 'topic', 'dismissed'];

describe('reading-list store — bucketQueue', () => {
  // A full ReadingItem arbitrary spanning every kind, bucket, and source. Ids are
  // assigned in the scenario builder so each item is unique.
  const itemSpecArb = fc.record({
    title: fc.string(),
    kind: fc.constantFrom(...ALL_KINDS),
    bucket: fc.constantFrom<Bucket>(...ALL_BUCKETS),
    source: fc.constantFrom(...SOURCES),
    words: fc.option(fc.nat({ max: 200000 }), { nil: undefined }),
    pages: fc.option(fc.nat({ max: 5000 }), { nil: undefined }),
    estMinutes: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
    read: fc.boolean(),
    order: fc.nat({ max: 1000 }),
    addedAt: fc.nat({ max: 2_000_000_000_000 }),
  });

  const scenarioArb = fc
    .record({
      itemSpecs: fc.array(itemSpecArb, { maxLength: 40 }),
      bucket: fc.constantFrom<Bucket>(...ALL_BUCKETS),
    })
    .map(({ itemSpecs, bucket }) => {
      const items: ReadingItem[] = itemSpecs.map((spec, i) => ({ ...spec, id: `i-${i}` }));
      return { items, bucket };
    });

  // Feature: ranking-page-redesign, Property 2: bucketQueue selects, sorts, and
  // excludes dismissed.
  // Validates: Requirements 4.1, 4.2, 4.3
  it('Property 2: returns exactly the bucket members sorted by order, never dismissed; dismissed arg → []', () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, bucket }) => {
        const result = bucketQueue(items, bucket);

        // R4.3 — a `dismissed` argument yields an empty list.
        if (bucket === 'dismissed') {
          expect(result).toEqual([]);
          return;
        }

        const resultIds = new Set(result.map((r) => r.id));

        // R4.1 / R4.2 — the result contains exactly the items whose bucket equals
        // the argument (dismissed items are excluded by definition since a
        // dismissed item's bucket can never equal a non-dismissed argument).
        const expected = items.filter((i) => i.bucket === bucket);
        expect(result).toHaveLength(expected.length);
        for (const item of expected) {
          expect(resultIds.has(item.id)).toBe(true);
        }

        // No returned item belongs to a different bucket, and none is dismissed.
        for (const r of result) {
          expect(r.bucket).toBe(bucket);
          expect(r.bucket).not.toBe('dismissed');
        }

        // R4.1 — sorted ascending by `order`.
        for (let i = 1; i < result.length; i++) {
          expect(result[i].order).toBeGreaterThanOrEqual(result[i - 1].order);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('reading-list store — moveToBucket promote-to-top', () => {
  // A full ReadingItem arbitrary spanning every kind, bucket, and source. Ids are
  // assigned in the scenario builder so each item is unique.
  const itemSpecArb = fc.record({
    title: fc.string(),
    kind: fc.constantFrom(...ALL_KINDS),
    bucket: fc.constantFrom<Bucket>(...ALL_BUCKETS),
    source: fc.constantFrom(...SOURCES),
    words: fc.option(fc.nat({ max: 200000 }), { nil: undefined }),
    pages: fc.option(fc.nat({ max: 5000 }), { nil: undefined }),
    estMinutes: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
    read: fc.boolean(),
    order: fc.nat({ max: 1000 }),
    addedAt: fc.nat({ max: 2_000_000_000_000 }),
  });

  // Build a scenario with at least one item so a present id can always be picked.
  const scenarioArb = fc
    .record({
      itemSpecs: fc.array(itemSpecArb, { minLength: 1, maxLength: 40 }),
      pickIdx: fc.nat({ max: 1000 }),
    })
    .map(({ itemSpecs, pickIdx }) => {
      const items: ReadingItem[] = itemSpecs.map((spec, i) => ({ ...spec, id: `i-${i}` }));
      const id = items[pickIdx % items.length].id;
      return { items, id };
    });

  // Feature: ranking-page-redesign, Property 6: moveToBucket to next-top inserts
  // at rank 0.
  // Validates: Requirements 6.2
  it('Property 6: moveToBucket(items, id, "next", { position: "top" }) places the item in next at order 0 with a contiguous next bucket', () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, id }) => {
        const result = moveToBucket(items, id, 'next', { position: 'top' });

        // The promoted item is now in the `next` bucket at order 0.
        const moved = result.find((i) => i.id === id);
        expect(moved).toBeDefined();
        expect(moved!.bucket).toBe('next');
        expect(moved!.order).toBe(0);

        // The `next` bucket's orders form a contiguous 0..n-1 sequence with no
        // gaps or duplicates.
        const nextOrders = result
          .filter((i) => i.bucket === 'next')
          .map((i) => i.order)
          .sort((a, b) => a - b);
        expect(nextOrders).toEqual(nextOrders.map((_, idx) => idx));
      }),
      { numRuns: 200 },
    );
  });
});

describe('reading-list store — bucket-order contiguity', () => {
  // A full ReadingItem arbitrary spanning every kind, bucket, and source. Ids are
  // assigned in the scenario builder so each item is unique.
  const itemSpecArb = fc.record({
    title: fc.string(),
    kind: fc.constantFrom(...ALL_KINDS),
    bucket: fc.constantFrom<Bucket>(...ALL_BUCKETS),
    source: fc.constantFrom(...SOURCES),
    words: fc.option(fc.nat({ max: 200000 }), { nil: undefined }),
    pages: fc.option(fc.nat({ max: 5000 }), { nil: undefined }),
    estMinutes: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
    read: fc.boolean(),
    order: fc.nat({ max: 1000 }),
    addedAt: fc.nat({ max: 2_000_000_000_000 }),
  });

  // A single operation to apply, chosen uniformly among the three helpers that
  // must preserve the contiguity invariant. Index fields select present ids
  // (mod list length) and are resolved in the property body; `fresh` fields feed
  // reorder degenerate/missing-id cases too. Random kind/bucket cover fileItem
  // and moveToBucket destinations, and `top`/`back` covers the next-top branch.
  const opArb = fc.oneof(
    fc.record({
      op: fc.constant('reorder' as const),
      draggedIdx: fc.nat({ max: 1000 }),
      targetIdx: fc.nat({ max: 1000 }),
    }),
    fc.record({
      op: fc.constant('moveToBucket' as const),
      idIdx: fc.nat({ max: 1000 }),
      bucket: fc.constantFrom<Bucket>(...ALL_BUCKETS),
      position: fc.constantFrom<'top' | 'back'>('top', 'back'),
    }),
    fc.record({
      op: fc.constant('fileItem' as const),
      idIdx: fc.nat({ max: 1000 }),
      kind: fc.constantFrom(...ALL_KINDS),
      bucket: fc.constantFrom<Bucket>(...ALL_BUCKETS),
    }),
  );

  // Build a scenario with at least one item so a present id can always be picked.
  // The starting list already satisfies the invariant: each non-dismissed bucket
  // is renumbered to a contiguous 0..n-1 sequence (using the generated `order`
  // only to decide relative rank), because the mutating helpers PRESERVE the
  // invariant rather than establish it across buckets they don't touch.
  const scenarioArb = fc
    .record({
      itemSpecs: fc.array(itemSpecArb, { minLength: 1, maxLength: 40 }),
      op: opArb,
    })
    .map(({ itemSpecs, op }) => {
      const raw: ReadingItem[] = itemSpecs.map((spec, i) => ({ ...spec, id: `i-${i}` }));
      // Renumber each non-dismissed bucket contiguously by the generated order
      // (ties broken by id) so the starting state is invariant-respecting.
      const rankByBucket = new Map<Bucket, Map<string, number>>();
      const grouped = new Map<Bucket, ReadingItem[]>();
      for (const it of raw) {
        if (it.bucket === 'dismissed') continue;
        const arr = grouped.get(it.bucket) ?? [];
        arr.push(it);
        grouped.set(it.bucket, arr);
      }
      for (const [bucket, arr] of grouped) {
        arr.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
        const m = new Map<string, number>();
        arr.forEach((it, idx) => m.set(it.id, idx));
        rankByBucket.set(bucket, m);
      }
      const items: ReadingItem[] = raw.map((it) =>
        it.bucket === 'dismissed' ? it : { ...it, order: rankByBucket.get(it.bucket)!.get(it.id)! },
      );
      return { items, op };
    });

  /**
   * Assert that every non-`dismissed` bucket containing items has `order`
   * values forming a contiguous 0..n-1 sequence (no gaps, no duplicates).
   */
  function assertContiguous(items: ReadingItem[]): void {
    const byBucket = new Map<Bucket, number[]>();
    for (const it of items) {
      if (it.bucket === 'dismissed') continue;
      const arr = byBucket.get(it.bucket) ?? [];
      arr.push(it.order);
      byBucket.set(it.bucket, arr);
    }
    for (const orders of byBucket.values()) {
      const sorted = [...orders].sort((a, b) => a - b);
      // 0..n-1 with no gaps or duplicates.
      expect(sorted).toEqual(sorted.map((_, idx) => idx));
    }
  }

  // Feature: ranking-page-redesign, Property 1: Bucket order stays contiguous.
  // Validates: Requirements 1.6, 5.1, 6.1, 7.1
  it('Property 1: after any single reorderWithinBucket/moveToBucket/fileItem op, every non-dismissed bucket with items has contiguous 0..n-1 orders', () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, op }) => {
        const ids = items.map((i) => i.id);
        let result: ReadingItem[];

        if (op.op === 'reorder') {
          const draggedId = ids[op.draggedIdx % ids.length];
          const targetId = ids[op.targetIdx % ids.length];
          result = reorderWithinBucket(items, draggedId, targetId);
        } else if (op.op === 'moveToBucket') {
          const id = ids[op.idIdx % ids.length];
          result = moveToBucket(items, id, op.bucket, { position: op.position });
        } else {
          const id = ids[op.idIdx % ids.length];
          result = fileItem(items, id, op.kind, op.bucket);
        }

        assertContiguous(result);
      }),
      { numRuns: 200 },
    );
  });
});

describe('reading-list store — fileItem sets kind and bucket', () => {
  // A full ReadingItem arbitrary spanning every kind, bucket, and source. Ids are
  // assigned in the scenario builder so each item is unique.
  const itemSpecArb = fc.record({
    title: fc.string(),
    kind: fc.constantFrom(...ALL_KINDS),
    bucket: fc.constantFrom<Bucket>(...ALL_BUCKETS),
    source: fc.constantFrom(...SOURCES),
    words: fc.option(fc.nat({ max: 200000 }), { nil: undefined }),
    pages: fc.option(fc.nat({ max: 5000 }), { nil: undefined }),
    estMinutes: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
    read: fc.boolean(),
    order: fc.nat({ max: 1000 }),
    addedAt: fc.nat({ max: 2_000_000_000_000 }),
  });

  // Build a scenario with at least one item so a present id can always be picked,
  // together with the target kind/bucket to file it into.
  const scenarioArb = fc
    .record({
      itemSpecs: fc.array(itemSpecArb, { minLength: 1, maxLength: 40 }),
      pickIdx: fc.nat({ max: 1000 }),
      kind: fc.constantFrom(...ALL_KINDS),
      bucket: fc.constantFrom<Bucket>(...ALL_BUCKETS),
    })
    .map(({ itemSpecs, pickIdx, kind, bucket }) => {
      const items: ReadingItem[] = itemSpecs.map((spec, i) => ({ ...spec, id: `i-${i}` }));
      const id = items[pickIdx % items.length].id;
      return { items, id, kind, bucket };
    });

  // Feature: ranking-page-redesign, Property 10: fileItem sets both kind and
  // bucket.
  // Validates: Requirements 7.1
  it('Property 10: fileItem sets the item\'s kind and bucket and places it at the back of the target bucket', () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, id, kind, bucket }) => {
        const result = fileItem(items, id, kind, bucket);

        // The filed item has its kind and bucket set to the given values.
        const moved = result.find((i) => i.id === id);
        expect(moved).toBeDefined();
        expect(moved!.kind).toBe(kind);
        expect(moved!.bucket).toBe(bucket);

        // The filed item sits at the back of the target bucket: its `order` is the
        // maximum among the target bucket's members (equivalently, it is placed
        // last). The target bucket is renumbered contiguously 0..n-1, so the back
        // order equals memberCount-1.
        const targetOrders = result
          .filter((i) => i.bucket === bucket)
          .map((i) => i.order);
        const maxOrder = Math.max(...targetOrders);
        expect(moved!.order).toBe(maxOrder);
        expect(moved!.order).toBe(targetOrders.length - 1);
      }),
      { numRuns: 100 },
    );
  });
});

describe('reading-list store — setRead self-clean', () => {
  // A full ReadingItem arbitrary spanning every kind, bucket, and source. Ids are
  // assigned in the scenario builder so each item is unique.
  const itemSpecArb = fc.record({
    title: fc.string(),
    kind: fc.constantFrom(...ALL_KINDS),
    bucket: fc.constantFrom<Bucket>(...ALL_BUCKETS),
    source: fc.constantFrom(...SOURCES),
    words: fc.option(fc.nat({ max: 200000 }), { nil: undefined }),
    pages: fc.option(fc.nat({ max: 5000 }), { nil: undefined }),
    estMinutes: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
    read: fc.boolean(),
    order: fc.nat({ max: 1000 }),
    addedAt: fc.nat({ max: 2_000_000_000_000 }),
  });

  // Build a scenario with at least one item so a present id can always be picked.
  const scenarioArb = fc
    .record({
      itemSpecs: fc.array(itemSpecArb, { minLength: 1, maxLength: 40 }),
      pickIdx: fc.nat({ max: 1000 }),
    })
    .map(({ itemSpecs, pickIdx }) => {
      const items: ReadingItem[] = itemSpecs.map((spec, i) => ({ ...spec, id: `i-${i}` }));
      const id = items[pickIdx % items.length].id;
      return { items, id };
    });

  // Feature: ranking-page-redesign, Property 7: setRead(true) self-cleans a next
  // item onto the shelf.
  // Validates: Requirements 8.1, 8.2, 8.3
  it('Property 7: setRead(true) moves a next item to shelf (read true, kind unchanged); any other bucket only flips read', () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, id }) => {
        const before = items.find((i) => i.id === id)!;
        const result = setRead(items, id, true);
        const after = result.find((i) => i.id === id);
        expect(after).toBeDefined();

        if (before.bucket === 'next') {
          // (a) A present `next` item self-cleans onto the shelf (R8.2): moved to
          // `shelf`, `read` set true, `kind` unchanged.
          expect(after!.bucket).toBe('shelf');
          expect(after!.read).toBe(true);
          expect(after!.kind).toBe(before.kind);
        } else {
          // (b) A present item in any other bucket: only `read` flips true, the
          // bucket is left unchanged (R8.1, R8.3).
          expect(after!.read).toBe(true);
          expect(after!.bucket).toBe(before.bucket);
          expect(after!.kind).toBe(before.kind);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('reading-list store — dismissItem tombstones and removeItem deletes', () => {
  // A full ReadingItem arbitrary spanning every kind, bucket, and source. Ids are
  // assigned in the scenario builder so each item is unique.
  const itemSpecArb = fc.record({
    title: fc.string(),
    kind: fc.constantFrom(...ALL_KINDS),
    bucket: fc.constantFrom<Bucket>(...ALL_BUCKETS),
    source: fc.constantFrom(...SOURCES),
    words: fc.option(fc.nat({ max: 200000 }), { nil: undefined }),
    pages: fc.option(fc.nat({ max: 5000 }), { nil: undefined }),
    estMinutes: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
    read: fc.boolean(),
    order: fc.nat({ max: 1000 }),
    addedAt: fc.nat({ max: 2_000_000_000_000 }),
  });

  // Build a non-empty scenario so a present id can always be picked.
  const scenarioArb = fc
    .record({
      itemSpecs: fc.array(itemSpecArb, { minLength: 1, maxLength: 40 }),
      pickIdx: fc.nat({ max: 1000 }),
    })
    .map(({ itemSpecs, pickIdx }) => {
      const items: ReadingItem[] = itemSpecs.map((spec, i) => ({ ...spec, id: `i-${i}` }));
      const id = items[pickIdx % items.length].id;
      return { items, id };
    });

  // Feature: ranking-page-redesign, Property 11: dismissItem tombstones and
  // removeItem deletes.
  // Validates: Requirements 9.1, 9.2
  it('Property 11: dismissItem sets bucket=dismissed so bucketQueue never returns it; removeItem deletes it and shrinks length by one', () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, id }) => {
        const before = items.find((i) => i.id === id)!;

        // ── dismissItem tombstones the item (R9.1) ────────────────────────
        const dismissed = dismissItem(items, id);
        const tombstoned = dismissed.find((i) => i.id === id);
        expect(tombstoned).toBeDefined();
        expect(tombstoned!.bucket).toBe('dismissed');

        // The item's FORMER bucket no longer returns it via bucketQueue, and no
        // bucketQueue over any bucket returns it (dismissed is always excluded).
        for (const bucket of ALL_BUCKETS) {
          const queueIds = bucketQueue(dismissed, bucket).map((i) => i.id);
          expect(queueIds).not.toContain(id);
        }
        // Explicitly re-check the item's former bucket for clarity.
        expect(bucketQueue(dismissed, before.bucket).map((i) => i.id)).not.toContain(id);

        // ── removeItem hard-deletes the item (R9.2) ───────────────────────
        const removed = removeItem(items, id);
        expect(removed).toHaveLength(items.length - 1);
        expect(removed.some((i) => i.id === id)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

describe('reading-list store — totalMinutes sums unread next items', () => {
  // A full ReadingItem arbitrary spanning every kind, bucket, and source. Ids are
  // assigned in the scenario builder so each item is unique. `estMinutes` is
  // deliberately optional so the missing-as-0 behavior is exercised.
  const itemSpecArb = fc.record({
    title: fc.string(),
    kind: fc.constantFrom(...ALL_KINDS),
    bucket: fc.constantFrom<Bucket>(...ALL_BUCKETS),
    source: fc.constantFrom(...SOURCES),
    words: fc.option(fc.nat({ max: 200000 }), { nil: undefined }),
    pages: fc.option(fc.nat({ max: 5000 }), { nil: undefined }),
    estMinutes: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
    read: fc.boolean(),
    order: fc.nat({ max: 1000 }),
    addedAt: fc.nat({ max: 2_000_000_000_000 }),
  });

  const scenarioArb = fc
    .array(itemSpecArb, { maxLength: 40 })
    .map((itemSpecs) => {
      const items: ReadingItem[] = itemSpecs.map((spec, i) => ({ ...spec, id: `i-${i}` }));
      return { items };
    });

  // Feature: ranking-page-redesign, Property 8: totalMinutes sums unread next
  // items only.
  // Validates: Requirements 10.1, 10.2, 10.3
  it('Property 8: totalMinutes equals the sum of estMinutes over exactly the unread next-bucket items (missing estMinutes as 0)', () => {
    fc.assert(
      fc.property(scenarioArb, ({ items }) => {
        // Independent oracle: sum estMinutes (missing → 0) over exactly the items
        // whose bucket is `next` and whose read flag is false. Every other bucket
        // is excluded (R10.2) and read items are excluded (R10.3); R10.1 is the
        // sum itself.
        const oracle = items.reduce(
          (sum, i) =>
            i.bucket === 'next' && i.read === false ? sum + (i.estMinutes ?? 0) : sum,
          0,
        );

        expect(totalMinutes(items)).toBe(oracle);
      }),
      { numRuns: 200 },
    );
  });
});

describe('reading-list store — formatMinutes total deterministic formatter', () => {
  // Feature: ranking-page-redesign, Property 12: formatMinutes is a total,
  // deterministic formatter.
  // Validates: Requirements 11.1
  it('Property 12: for any m >= 0, formatMinutes(m) is a non-empty string and is deterministic across repeated calls', () => {
    fc.assert(
      fc.property(fc.nat(), (m) => {
        // Total: defined for every non-negative minute count (fc.nat yields m >= 0),
        // returning a non-empty human-readable string.
        const out = formatMinutes(m);
        expect(typeof out).toBe('string');
        expect(out.length).toBeGreaterThan(0);

        // Deterministic + side-effect-free: two calls with the same input return
        // the identical string.
        expect(formatMinutes(m)).toBe(out);
      }),
      { numRuns: 200 },
    );
  });
});

describe('reading-list store — mutating helpers are no-ops on missing/degenerate ids', () => {
  // A full ReadingItem arbitrary spanning every kind, bucket, and source. Ids are
  // assigned in the scenario builder (prefixed `i-`) so every list id is known
  // and an absent id can be chosen that can never collide.
  const itemSpecArb = fc.record({
    title: fc.string(),
    kind: fc.constantFrom(...ALL_KINDS),
    bucket: fc.constantFrom<Bucket>(...ALL_BUCKETS),
    source: fc.constantFrom(...SOURCES),
    words: fc.option(fc.nat({ max: 200000 }), { nil: undefined }),
    pages: fc.option(fc.nat({ max: 5000 }), { nil: undefined }),
    estMinutes: fc.option(fc.nat({ max: 10000 }), { nil: undefined }),
    read: fc.boolean(),
    order: fc.nat({ max: 1000 }),
    addedAt: fc.nat({ max: 2_000_000_000_000 }),
  });

  // Any reading list (possibly empty). Ids are `i-{n}`; the target kind/bucket
  // feed fileItem/moveToBucket, and pickIdx selects a present id when the list is
  // non-empty.
  const scenarioArb = fc
    .record({
      itemSpecs: fc.array(itemSpecArb, { maxLength: 40 }),
      pickIdx: fc.nat({ max: 1000 }),
      kind: fc.constantFrom(...ALL_KINDS),
      bucket: fc.constantFrom<Bucket>(...ALL_BUCKETS),
    })
    .map(({ itemSpecs, pickIdx, kind, bucket }) => {
      const items: ReadingItem[] = itemSpecs.map((spec, i) => ({ ...spec, id: `i-${i}` }));
      return { items, pickIdx, kind, bucket };
    });

  // An id that is guaranteed absent from the list (list ids are all `i-{n}`).
  const ABSENT_ID = 'absent-id-not-in-list';

  // Feature: ranking-page-redesign, Property 9: Mutating helpers are no-ops on
  // missing or degenerate ids.
  // Validates: Requirements 5.2, 5.3, 5.4, 6.3, 7.2, 8.4, 9.3, 19.4
  it('Property 9: all six mutating helpers return the SAME list reference for a missing id, and reorderWithinBucket is a no-op for equal ids or cross-bucket ids', () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, pickIdx, kind, bucket }) => {
        // ── (1) Each helper called with an id ABSENT from the list is a no-op ──
        // Every helper returns the SAME array reference unchanged (identity
        // compare) when the id does not exist (R5.4, R6.3, R7.2, R8.4, R9.3).
        expect(reorderWithinBucket(items, ABSENT_ID, `${ABSENT_ID}-2`)).toBe(items);
        expect(moveToBucket(items, ABSENT_ID, bucket, { position: 'top' })).toBe(items);
        expect(moveToBucket(items, ABSENT_ID, bucket)).toBe(items);
        expect(fileItem(items, ABSENT_ID, kind, bucket)).toBe(items);
        expect(setRead(items, ABSENT_ID, true)).toBe(items);
        expect(setRead(items, ABSENT_ID, false)).toBe(items);
        expect(dismissItem(items, ABSENT_ID)).toBe(items);
        expect(removeItem(items, ABSENT_ID)).toBe(items);

        if (items.length === 0) return;
        const picked = items[pickIdx % items.length];

        // ── (2) reorderWithinBucket with draggedId === targetId is a no-op ────
        // Degenerate reorder (same slot) returns the SAME reference (R5.2), even
        // for a present id.
        expect(reorderWithinBucket(items, picked.id, picked.id)).toBe(items);
        // Also a no-op when BOTH the equal ids are absent from the list.
        expect(reorderWithinBucket(items, ABSENT_ID, ABSENT_ID)).toBe(items);

        // ── (3) reorderWithinBucket across DIFFERENT buckets is a no-op ───────
        // Find any pair of present items in different buckets; a reorder between
        // them must be a no-op returning the SAME reference (R5.3).
        const other = items.find((i) => i.bucket !== picked.bucket);
        if (other) {
          expect(reorderWithinBucket(items, picked.id, other.id)).toBe(items);
          expect(reorderWithinBucket(items, other.id, picked.id)).toBe(items);
        }
      }),
      { numRuns: 200 },
    );
  });
});
