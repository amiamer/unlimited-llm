'use client';

/**
 * Reader summary persistence.
 * Feature: reader-workspace
 *
 * Every edit is written synchronously to localStorage and queued to a separate
 * IndexedDB database. localStorage remains the synchronous source consumed by
 * Book_Note serialization; IndexedDB is the durable second copy and can restore
 * a missing localStorage value. Debounced UI commits also create bounded
 * revision checkpoints so an accidental overwrite can be recovered.
 */

const PREFIX = 'reader-summary';
const META_PREFIX = 'reader-summary-meta';
const DB_NAME = 'reader-summaries';
const DB_VERSION = 1;
const CURRENT_STORE = 'current';
const HISTORY_STORE = 'history';
const HISTORY_INDEX = 'byKey';
const MAX_HISTORY_PER_SUMMARY = 30;

interface SummaryRecord {
  key: string;
  docId: string;
  chapter: number;
  text: string;
  updatedAt: number;
}

interface SummaryHistoryRecord extends SummaryRecord {
  id: string;
}

interface SummaryMeta {
  updatedAt: number;
}

export interface SummaryRecoveryEntry {
  source: 'current' | 'history';
  docId: string;
  chapter: number;
  text: string;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
const writeQueues = new Map<string, Promise<boolean>>();

function keyFor(docId: string, chapter: number): string {
  return `${PREFIX}:${docId}:${chapter}`;
}

function metaKeyFor(docId: string, chapter: number): string {
  return `${META_PREFIX}:${docId}:${chapter}`;
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function hasIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function readMeta(docId: string, chapter: number): SummaryMeta | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(metaKeyFor(docId, chapter));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SummaryMeta>;
    return typeof parsed.updatedAt === 'number' ? { updatedAt: parsed.updatedAt } : null;
  } catch {
    return null;
  }
}

/** Write only the synchronous local copy; does not enqueue another IDB write. */
function writeLocal(docId: string, chapter: number, text: string, updatedAt: number): boolean {
  if (!hasStorage() || !docId) return false;
  try {
    if (text.trim()) window.localStorage.setItem(keyFor(docId, chapter), text);
    else window.localStorage.removeItem(keyFor(docId, chapter));
    window.localStorage.setItem(metaKeyFor(docId, chapter), JSON.stringify({ updatedAt }));
    return true;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CURRENT_STORE)) {
        db.createObjectStore(CURRENT_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        const history = db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
        history.createIndex(HISTORY_INDEX, 'key', { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('Unable to open summary backup'));
    };
  });
  return dbPromise;
}

function putCurrent(record: SummaryRecord): Promise<boolean> {
  return openDb().then((db) => new Promise<boolean>((resolve) => {
    const tx = db.transaction(CURRENT_STORE, 'readwrite');
    tx.objectStore(CURRENT_STORE).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  })).catch(() => false);
}

/** Serialize writes per summary so rapid keystrokes can never land out of order. */
function enqueueCurrent(record: SummaryRecord): Promise<boolean> {
  const previous = writeQueues.get(record.key) ?? Promise.resolve(true);
  const next = previous.then(() => putCurrent(record), () => putCurrent(record));
  writeQueues.set(record.key, next);
  void next.finally(() => {
    if (writeQueues.get(record.key) === next) writeQueues.delete(record.key);
  });
  return next;
}

function getCurrent(key: string): Promise<SummaryRecord | null> {
  return openDb().then((db) => new Promise<SummaryRecord | null>((resolve) => {
    const req = db.transaction(CURRENT_STORE, 'readonly').objectStore(CURRENT_STORE).get(key);
    req.onsuccess = () => resolve((req.result as SummaryRecord | undefined) ?? null);
    req.onerror = () => resolve(null);
  })).catch(() => null);
}

/** Load the synchronous localStorage copy (empty string if none). */
export function loadSummary(docId: string, chapter: number): string {
  if (!hasStorage() || !docId) return '';
  try {
    return window.localStorage.getItem(keyFor(docId, chapter)) ?? '';
  } catch {
    return '';
  }
}

/**
 * Load the newest copy across localStorage and IndexedDB. Legacy localStorage
 * values have no timestamp, so they win once and are migrated forward rather
 * than being overwritten by an older backup.
 */
export async function loadSummaryDurable(docId: string, chapter: number): Promise<string> {
  if (!docId) return '';
  const key = keyFor(docId, chapter);
  const pending = writeQueues.get(key);
  if (pending) await pending;

  const durable = await getCurrent(key);
  // Re-read after the asynchronous IDB operation. An edit may have happened
  // while that read was in flight; this is the compare side of the restore CAS.
  const localText = loadSummary(docId, chapter);
  const localMeta = readMeta(docId, chapter);

  if (localText && !localMeta) {
    // Existing pre-upgrade summary: preserve it and establish both timestamps.
    saveSummary(docId, chapter, localText);
    return localText;
  }
  if (localMeta && (!durable || localMeta.updatedAt >= durable.updatedAt)) {
    if (!durable || durable.text !== localText || durable.updatedAt !== localMeta.updatedAt) {
      void enqueueCurrent({ key, docId, chapter, text: localText, updatedAt: localMeta.updatedAt });
    }
    return localText;
  }
  if (durable) {
    writeLocal(docId, chapter, durable.text, durable.updatedAt);
    return durable.text;
  }
  return localText;
}

/** Load every locally materialized chapter summary, sorted by chapter. */
export function loadAllSummaries(docId: string): { chapter: number; text: string }[] {
  if (!hasStorage() || !docId) return [];
  const prefix = `${PREFIX}:${docId}:`;
  const out: { chapter: number; text: string }[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const chapter = Number.parseInt(k.slice(prefix.length), 10);
      if (!Number.isInteger(chapter)) continue;
      const text = window.localStorage.getItem(k) ?? '';
      if (text.trim()) out.push({ chapter, text });
    }
  } catch {
    /* A blocked localStorage still leaves the IndexedDB copy for later recovery. */
  }
  return out.sort((a, b) => a.chapter - b.chapter);
}

/**
 * Persist an edit immediately to localStorage and queue the same version to
 * IndexedDB. Returns whether the synchronous local copy succeeded.
 */
export function saveSummary(docId: string, chapter: number, text: string): boolean {
  if (!docId) return false;
  const updatedAt = Date.now();
  const localOk = writeLocal(docId, chapter, text, updatedAt);
  void enqueueCurrent({ key: keyFor(docId, chapter), docId, chapter, text, updatedAt });
  return localOk;
}

/** Create a recoverable revision after the user pauses, blurs, or collapses. */
export async function checkpointSummary(
  docId: string,
  chapter: number,
  text: string,
): Promise<boolean> {
  if (!docId) return false;
  const key = keyFor(docId, chapter);
  const pending = writeQueues.get(key);
  if (pending) await pending;

  const current = await getCurrent(key);
  // saveSummary owns the authoritative per-keystroke current record. A
  // checkpoint is history-only: writing `text` back to current here could race
  // a newer queued edit and regress the durable copy.
  const record: SummaryRecord = current ?? {
    key, docId, chapter, text, updatedAt: Date.now(),
  };

  return openDb().then((db) => new Promise<boolean>((resolve) => {
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    const store = tx.objectStore(HISTORY_STORE);
    const index = store.index(HISTORY_INDEX);
    const req = index.getAll(IDBKeyRange.only(key));
    req.onsuccess = () => {
      const existing = (req.result as SummaryHistoryRecord[])
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const latest = existing[0];
      if (!latest || latest.text !== text) {
        const stamp = Date.now();
        store.put({ ...record, text, updatedAt: stamp, id: `${key}:${stamp}:${Math.random()}` });
      }
      for (const old of existing.slice(MAX_HISTORY_PER_SUMMARY - 1)) store.delete(old.id);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  })).catch(() => false);
}

/** Enumerate the IndexedDB current copy and revision history for recovery UI/tools. */
export async function loadSummaryRecovery(
  docId?: string,
): Promise<SummaryRecoveryEntry[]> {
  return openDb().then((db) => new Promise<SummaryRecoveryEntry[]>((resolve) => {
    const tx = db.transaction([CURRENT_STORE, HISTORY_STORE], 'readonly');
    const currentReq = tx.objectStore(CURRENT_STORE).getAll();
    const historyReq = tx.objectStore(HISTORY_STORE).getAll();
    tx.oncomplete = () => {
      const current = (currentReq.result as SummaryRecord[])
        .filter((r) => !docId || r.docId === docId)
        .map((r) => ({ ...r, source: 'current' as const }));
      const history = (historyReq.result as SummaryHistoryRecord[])
        .filter((r) => !docId || r.docId === docId)
        .map((r) => ({ ...r, source: 'history' as const }));
      resolve([...current, ...history]
        .map(({ source, docId: id, chapter, text, updatedAt }) => ({
          source, docId: id, chapter, text, updatedAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt));
    };
    tx.onerror = () => resolve([]);
    tx.onabort = () => resolve([]);
  })).catch(() => []);
}
