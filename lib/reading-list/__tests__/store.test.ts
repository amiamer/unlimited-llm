/**
 * Unit tests for the reading-list store helpers.
 * Feature: reading-list
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  wordCount, estimateMinutes, timeLabel, lengthLabel,
  reconcileSeeds,
  loadReadingList,
  type ReadingItem,
} from '../store';

function item(p: Partial<ReadingItem>): ReadingItem {
  return { id: 'x', title: 'T', kind: 'article', bucket: 'shelf', source: 'manual', read: false, order: 0, addedAt: 0, ...p };
}

describe('length + time estimates', () => {
  it('counts words, ignoring html', () => {
    expect(wordCount('<p>one two</p> three')).toBe(3);
    expect(wordCount('')).toBe(0);
  });
  it('estimates minutes from words or pages', () => {
    expect(estimateMinutes(2200)).toBe(10);
    expect(estimateMinutes(undefined, 100)).toBe(180);
    expect(estimateMinutes()).toBeUndefined();
  });
  it('formats time and length labels', () => {
    expect(timeLabel(item({ estMinutes: 15 }))).toBe('~15 min');
    expect(timeLabel(item({ estMinutes: 130 }))).toBe('~2 h 10 m');
    expect(lengthLabel(item({ words: 3400 }))).toBe('~3,400 words');
    expect(lengthLabel(item({ pages: 120 }))).toBe('~120 pages');
  });
});

describe('reconcileSeeds', () => {
  it('refreshes fixed titles, keeps filing, drops orphans, keeps manual, adds new', () => {
    const items = [
      item({ id: 'link-mercantilism', title: 'mercantilism', kind: 'concept', source: 'link', order: 0 }),
      item({ id: 'link-gone', title: 'old junk', kind: 'unsorted', source: 'link', order: 1 }),
      item({ id: 'm1', title: 'My book', kind: 'book', source: 'manual', order: 0 }),
    ];
    const seeds = [
      { id: 'link-mercantilism', title: 'Mercantilism', kind: 'unsorted' as const, bucket: 'inbox' as const, source: 'link' as const },
      { id: 'link-new', title: 'Globalization', kind: 'unsorted' as const, bucket: 'inbox' as const, source: 'link' as const },
    ];
    const out = reconcileSeeds(items, seeds);
    // fixed name shows fixed, but the reader's filing (concept) is preserved
    expect(out.find((i) => i.id === 'link-mercantilism')).toMatchObject({ title: 'Mercantilism', kind: 'concept' });
    // deleted/retargeted link is dropped
    expect(out.find((i) => i.id === 'link-gone')).toBeUndefined();
    // manual item survives
    expect(out.find((i) => i.id === 'm1')).toBeTruthy();
    // new captured link is added as unsorted
    expect(out.find((i) => i.id === 'link-new')).toMatchObject({ kind: 'unsorted' });
  });
});

describe('loadReadingList — fresh browser (task 2.2)', () => {
  // Empty-store mock: getItem always returns null, mirroring a browser that has
  // never written either reading-list key.
  function installEmptyLocalStorageMock(): void {
    const backing = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
        setItem: (k: string, v: string) => void backing.set(k, v),
        removeItem: (k: string) => void backing.delete(k),
      },
    });
  }

  beforeEach(() => {
    installEmptyLocalStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Validates: Requirements 2.2, 19.1
  it('returns [] and does not crash when both v3 and v2 keys are absent', () => {
    // Both reading-list:v3 and reading-list:v2 reads return null here, so the
    // migration path must guard the null v2 read rather than dereference it.
    expect(() => loadReadingList()).not.toThrow();
    expect(loadReadingList()).toEqual([]);
  });
});

describe('loadReadingList — v2→v3 migration + corrupt storage (task 2.3)', () => {
  // Seedable in-memory localStorage mock: the backing map is exposed so tests
  // can seed keys directly and assert on the final state after migration.
  let backing: Map<string, string>;

  function installSeedableLocalStorageMock(): void {
    backing = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
        setItem: (k: string, v: string) => void backing.set(k, v),
        removeItem: (k: string) => void backing.delete(k),
      },
    });
  }

  beforeEach(() => {
    installSeedableLocalStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A pre-migration (v2) item: identical to a ReadingItem minus the `bucket`.
  function v2Item(p: Partial<Omit<ReadingItem, 'bucket'>>): Omit<ReadingItem, 'bucket'> {
    return { id: 'x', title: 'T', kind: 'article', source: 'manual', read: false, order: 0, addedAt: 0, ...p };
  }

  // Validates: Requirements 2.3, 2.4, 2.5
  it('maps v2 items to the correct buckets by kind', () => {
    const v2 = [
      v2Item({ id: 'u', kind: 'unsorted' }),
      v2Item({ id: 'a', kind: 'article' }),
      v2Item({ id: 's', kind: 'sep' }),
      v2Item({ id: 'b', kind: 'book' }),
      v2Item({ id: 'pa', kind: 'paper' }),
      v2Item({ id: 'per', kind: 'person' }),
      v2Item({ id: 'ev', kind: 'event' }),
      v2Item({ id: 'pl', kind: 'place' }),
      v2Item({ id: 'org', kind: 'organization' }),
      v2Item({ id: 'con', kind: 'concept' }),
      v2Item({ id: 'rel', kind: 'religion' }),
      v2Item({ id: 'peri', kind: 'period' }),
      v2Item({ id: 'tech', kind: 'technology' }),
    ];
    backing.set('reading-list:v2', JSON.stringify(v2));

    const bucketById = new Map(loadReadingList().map((i) => [i.id, i.bucket]));
    // unsorted → inbox
    expect(bucketById.get('u')).toBe('inbox');
    // READABLE_KINDS → shelf
    expect(bucketById.get('a')).toBe('shelf');
    expect(bucketById.get('s')).toBe('shelf');
    expect(bucketById.get('b')).toBe('shelf');
    expect(bucketById.get('pa')).toBe('shelf');
    // TOPIC_KINDS → topic
    for (const id of ['per', 'ev', 'pl', 'org', 'con', 'rel', 'peri', 'tech']) {
      expect(bucketById.get(id)).toBe('topic');
    }
  });

  // Validates: Requirements 2.7
  it('preserves the item count through migration', () => {
    const v2 = [
      v2Item({ id: 'u', kind: 'unsorted' }),
      v2Item({ id: 'a', kind: 'article' }),
      v2Item({ id: 'per', kind: 'person' }),
    ];
    backing.set('reading-list:v2', JSON.stringify(v2));
    expect(loadReadingList()).toHaveLength(v2.length);
  });

  // Validates: Requirements 2.6
  it('preserves all non-bucket fields unchanged, only adding bucket', () => {
    const source = v2Item({
      id: 'article-42',
      title: 'An Essay on Example Topics',
      kind: 'article',
      source: 'article',
      words: 3400,
      pages: 120,
      estMinutes: 15,
      read: true,
      order: 7,
      addedAt: 1_700_000_000_000,
    });
    backing.set('reading-list:v2', JSON.stringify([source]));

    const migrated = loadReadingList();
    expect(migrated).toHaveLength(1);
    // Every original field is carried over untouched.
    expect(migrated[0]).toMatchObject(source);
    // And exactly one new field — bucket — is added (shelf for a readable kind).
    expect(migrated[0].bucket).toBe('shelf');
    expect(Object.keys(migrated[0]).sort()).toEqual(
      [...Object.keys(source), 'bucket'].sort(),
    );
  });

  // Validates: Requirements 2.2
  it('removes reading-list:v2 and writes reading-list:v3 after migration', () => {
    const v2 = [v2Item({ id: 'a', kind: 'article' }), v2Item({ id: 'per', kind: 'person' })];
    backing.set('reading-list:v2', JSON.stringify(v2));

    const migrated = loadReadingList();

    // v2 key is gone…
    expect(backing.has('reading-list:v2')).toBe(false);
    // …and v3 now holds the migrated list.
    expect(backing.has('reading-list:v3')).toBe(true);
    expect(JSON.parse(backing.get('reading-list:v3')!)).toEqual(migrated);
  });

  // Validates: Requirements 2.1
  it('prefers reading-list:v3 and does not touch v2 when v3 exists', () => {
    const v3 = [{ id: 'a', title: 'A', kind: 'article', bucket: 'shelf', source: 'article', read: false, order: 0, addedAt: 0 }];
    backing.set('reading-list:v3', JSON.stringify(v3));
    backing.set('reading-list:v2', JSON.stringify([v2Item({ id: 'legacy', kind: 'book' })]));

    expect(loadReadingList()).toEqual(v3);
    // v2 is left untouched because migration never runs when v3 is present.
    expect(backing.has('reading-list:v2')).toBe(true);
  });

  // Validates: Requirements 19.1
  it('returns [] when the v3 payload is corrupt/unparseable', () => {
    backing.set('reading-list:v3', '{ this is not : valid json ]');
    expect(() => loadReadingList()).not.toThrow();
    expect(loadReadingList()).toEqual([]);
  });

  // Validates: Requirements 19.1
  it('returns [] when the v2 payload is corrupt/unparseable', () => {
    backing.set('reading-list:v2', 'not json at all <<<');
    expect(() => loadReadingList()).not.toThrow();
    expect(loadReadingList()).toEqual([]);
  });
});
