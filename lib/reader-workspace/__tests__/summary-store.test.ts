/**
 * Summary persistence tests.
 * Feature: reader-workspace
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadAllSummaries,
  loadSummary,
  loadSummaryDurable,
  saveSummary,
} from '../summary-store';

function installLocalStorageMock(): Storage {
  const backing = new Map<string, string>();
  const storage = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, String(value)),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
    key: (index: number) => Array.from(backing.keys())[index] ?? null,
    get length() { return backing.size; },
  } as Storage;
  vi.stubGlobal('window', { localStorage: storage, indexedDB: undefined });
  return storage;
}

describe('summary-store', () => {
  beforeEach(() => installLocalStorageMock());

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads an existing legacy raw-text summary without changing its key format', () => {
    window.localStorage.setItem('reader-summary:Understanding:0', 'complete recovered text');
    expect(loadSummary('Understanding', 0)).toBe('complete recovered text');
  });

  it('writes each edit synchronously and retains source-scoped docIds', () => {
    expect(saveSummary('wikipedia:Understanding', 0, 'new ending')).toBe(true);
    expect(window.localStorage.getItem('reader-summary:wikipedia:Understanding:0'))
      .toBe('new ending');
    expect(loadSummary('wikipedia:Understanding', 0)).toBe('new ending');
  });

  it('loads all nonblank chapters in numeric order', () => {
    saveSummary('book', 3, 'fourth');
    saveSummary('book', 0, 'first');
    saveSummary('book', 2, '   ');
    expect(loadAllSummaries('book')).toEqual([
      { chapter: 0, text: 'first' },
      { chapter: 3, text: 'fourth' },
    ]);
  });

  it('removes a blank raw value while retaining metadata for intentional clears', () => {
    saveSummary('Understanding', 0, 'draft');
    saveSummary('Understanding', 0, '');
    expect(loadSummary('Understanding', 0)).toBe('');
    expect(window.localStorage.getItem('reader-summary-meta:Understanding:0')).not.toBeNull();
  });

  it('returns the local copy when IndexedDB is unavailable', async () => {
    saveSummary('Understanding', 0, 'safe local copy');
    await expect(loadSummaryDurable('Understanding', 0)).resolves.toBe('safe local copy');
  });
});
