/**
 * Unified reader — Library aggregation.
 * Feature: unified-reader
 *
 * Article storage uses IndexedDB (not localStorage) so large Wikipedia HTML
 * doesn't hit the 5 MB localStorage quota.
 */

import type { ReadingSourceType } from './types';

export interface ArticleLibraryEntry {
  id: string;
  type: ReadingSourceType;
  title: string;
  content: string;
  url?: string;
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

const DB_NAME = 'reader-articles';
const DB_VERSION = 1;
const STORE = 'articles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Stored shape ──────────────────────────────────────────────────────────────

interface StoredArticle {
  id: string;
  type: ReadingSourceType;
  title: string;
  content: string;
  url?: string;
  savedAt: number; // timestamp for ordering
}

// ── Public API ────────────────────────────────────────────────────────────────

// ── Server copy (/api/reader/articles) ───────────────────────────────────────
// The server's files are the shared library; IndexedDB caches the text. Server
// calls are best-effort: offline, the browser's own copy still works.

function uploadArticle(article: StoredArticle, restore = false): void {
  fetch('/api/reader/articles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...article, restore }),
  }).catch(() => { /* retried on the next library read */ });
}

/**
 * Merge the server library into this browser: drop articles removed elsewhere,
 * download ones saved elsewhere, and upload ones only this browser has.
 */
async function syncWithServer(db: IDBDatabase, local: StoredArticle[]): Promise<StoredArticle[]> {
  const res = await fetch('/api/reader/articles', { cache: 'no-store' });
  if (!res.ok) return local;
  const data = (await res.json()) as { articles: Omit<StoredArticle, 'content'>[]; removed: string[] };
  const removed = new Set(data.removed);
  const onServer = new Set(data.articles.map(a => a.id));
  const byId = new Map(local.map(a => [a.id, a]));

  for (const a of local) {
    if (removed.has(a.id)) {
      byId.delete(a.id);
      await tx(db, 'readwrite', s => s.delete(a.id)).catch(() => undefined);
    } else if (!onServer.has(a.id)) {
      uploadArticle(a);
    }
  }

  const missing = data.articles.filter(a => !byId.has(a.id));
  await Promise.all(missing.map(async (meta) => {
    try {
      const r = await fetch(`/api/reader/articles?id=${encodeURIComponent(meta.id)}`, { cache: 'no-store' });
      if (!r.ok) return;
      const { article } = (await r.json()) as { article: StoredArticle };
      byId.set(article.id, article);
      await tx(db, 'readwrite', s => s.put(article));
    } catch { /* fetched next time */ }
  }));

  return [...byId.values()];
}

export async function readArticleLibrary(): Promise<ArticleLibraryEntry[]> {
  if (typeof window === 'undefined') return [];
  try {
    const db = await openDb();
    let rows = (await tx(db, 'readonly', s => s.getAll())) as StoredArticle[];
    try {
      rows = await syncWithServer(db, rows);
    } catch { /* server unreachable: use this browser's copy */ }
    return rows
      .sort((a, b) => b.savedAt - a.savedAt)
      .map(({ id, type, title, content, url }) => ({ id, type, title, content, url }));
  } catch {
    return [];
  }
}

export async function fetchAndSaveArticle(
  type: 'wikipedia' | 'sep' | 'iep',
  query: string,
): Promise<ArticleLibraryEntry> {
  const endpoint =
    type === 'sep' ? '/api/sep/search'
    : type === 'iep' ? '/api/iep/search'
    : '/api/wikipedia/search';
  const res = await fetch(`${endpoint}?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
  const data = (await res.json()) as { title: string; content: string; url?: string };

  // Scope the id by SOURCE type so the same title from different sources — e.g.
  // the Wikipedia "Baruch Spinoza" and the SEP "Baruch Spinoza" — become DISTINCT
  // reading sessions with distinct annotations, instead of colliding on the title
  // alone (the old id was just the title, so the second source was silently
  // dropped and shared the first's docId/annotations).
  const slug = data.title.replace(/[<>:"/\\|?*]/g, '_');
  const id = `${type}:${slug}`;
  // Articles saved before ids were type-scoped used the bare slug. Reuse such a
  // legacy entry (same source) so re-searching it doesn't create a duplicate and
  // its existing annotations stay attached to their original docId.
  const legacyId = slug;
  const entry: ArticleLibraryEntry = { id, type, title: data.title, content: data.content, url: data.url };

  if (typeof window !== 'undefined') {
    try {
      const db = await openDb();
      const existingNew = (await tx(db, 'readonly', s => s.get(id))) as StoredArticle | undefined;
      if (existingNew) return entry;
      const existingLegacy = (await tx(db, 'readonly', s => s.get(legacyId))) as StoredArticle | undefined;
      if (existingLegacy && existingLegacy.type === type) {
        // Keep the legacy record and its annotations (keyed by legacyId) intact.
        return { id: legacyId, type, title: data.title, content: data.content, url: data.url };
      }
      const stored = { ...entry, savedAt: Date.now() };
      await tx(db, 'readwrite', s => s.put(stored));
      // Saving again on purpose brings back an article removed earlier.
      uploadArticle(stored, true);
    } catch { /* non-fatal */ }
  }

  return entry;
}

export async function removeArticleFromLibrary(id: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const db = await openDb();
    await tx(db, 'readwrite', s => s.delete(id));
  } catch { /* ignore */ }
  await fetch(`/api/reader/articles?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
}
