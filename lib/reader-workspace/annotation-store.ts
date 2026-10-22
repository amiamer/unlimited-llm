/**
 * Reader Workspace — per-document annotation persistence.
 * Feature: reader-workspace
 *
 * Primary storage: IndexedDB (`reader-workspace` DB, `annotations` store).
 * Backup storage: localStorage (same keys as before).
 * History: append-only snapshots (`reader-workspace-history` DB) — every save
 * of a non-empty set also archives a copy that no later overwrite can touch,
 * so even a bug that wipes both live stores is recoverable in one call
 * (loadLatestSnapshot). Kept in a SEPARATE database so it never version-locks
 * or blocks the live store.
 * Both live stores are written on every save. Load reads both and returns the
 * richer set (see loadAnnotations).
 */

import type { Annotation } from './types';
import { isAnchorWithinDoc } from './anchor';

const STORAGE_PREFIX = 'reader-annotations:';
const PAGECOUNT_PREFIX = 'reader-annotations-pagecount:';
const SYNCCOUNT_PREFIX = 'reader-annotations-synccount:';
const STORAGE_VERSION = 1;

export interface AnnotationStoreRecord {
  version: number;
  docId: string;
  annotations: Annotation[];
  updatedAt: string;
}

function keyFor(docId: string): string { return `${STORAGE_PREFIX}${docId}`; }
function pageCountKeyFor(docId: string): string { return `${PAGECOUNT_PREFIX}${docId}`; }
function hasStorage(): boolean { return typeof window !== 'undefined' && !!window.localStorage; }

// ── IndexedDB ─────────────────────────────────────────────────────────────────

const IDB_NAME = 'reader-workspace';
const IDB_VERSION = 1;
const IDB_STORE = 'annotations';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE, { keyPath: 'docId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(docId: string): Promise<AnnotationStoreRecord | null> {
  if (typeof window === 'undefined') return null;
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(docId);
      req.onsuccess = () => resolve((req.result as AnnotationStoreRecord) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

async function idbPut(record: AnnotationStoreRecord): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch { /* non-fatal */ }
}

async function idbDelete(docId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(docId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch { /* non-fatal */ }
}

// ── Snapshot history (append-only wipe insurance) ─────────────────────────────

const HIST_DB_NAME = 'reader-workspace-history';
const HIST_DB_VERSION = 1;
const HIST_STORE = 'snapshots';
/** Snapshots kept per document; oldest pruned beyond this. */
const MAX_SNAPSHOTS_PER_DOC = 15;

interface SnapshotRecord {
  /** `${docId}::${savedAt}` — sorts chronologically within a doc prefix. */
  key: string;
  docId: string;
  annotations: Annotation[];
  savedAt: string;
}

function openHistDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HIST_DB_NAME, HIST_DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(HIST_STORE)) {
        req.result.createObjectStore(HIST_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function histReq<T>(r: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result as T);
    r.onerror = () => reject(r.error);
  });
}

/** Archive a copy of a non-empty set. Best-effort; never throws. */
async function pushSnapshot(docId: string, annotations: Annotation[]): Promise<void> {
  if (typeof window === 'undefined' || annotations.length === 0) return;
  try {
    const db = await openHistDb();
    const savedAt = new Date().toISOString();
    const record: SnapshotRecord = { key: `${docId}::${savedAt}`, docId, annotations, savedAt };
    await histReq(db.transaction(HIST_STORE, 'readwrite').objectStore(HIST_STORE).put(record));
    // Prune oldest snapshots beyond the cap (keys sort chronologically).
    const keys = (await histReq<IDBValidKey[]>(
      db.transaction(HIST_STORE, 'readonly').objectStore(HIST_STORE).getAllKeys(),
    )).map(String).filter((k) => k.startsWith(`${docId}::`)).sort();
    if (keys.length > MAX_SNAPSHOTS_PER_DOC) {
      const stale = keys.slice(0, keys.length - MAX_SNAPSHOTS_PER_DOC);
      const store = db.transaction(HIST_STORE, 'readwrite').objectStore(HIST_STORE);
      for (const k of stale) store.delete(k);
    }
  } catch { /* history is best-effort */ }
}

/** List a document's snapshots, newest first (metadata + counts). */
export async function listSnapshots(
  docId: string,
): Promise<Array<{ savedAt: string; count: number }>> {
  if (typeof window === 'undefined') return [];
  try {
    const db = await openHistDb();
    const all = await histReq<SnapshotRecord[]>(
      db.transaction(HIST_STORE, 'readonly').objectStore(HIST_STORE).getAll(),
    );
    return all
      .filter((s) => s.docId === docId)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .map((s) => ({ savedAt: s.savedAt, count: s.annotations.length }));
  } catch { return []; }
}

/**
 * The most recent archived snapshot for a document (or the latest one at/before
 * `before`, when given). Recovery path for a wiped live store: NOT consulted
 * automatically by loadAnnotations, because a legitimately emptied doc (user
 * deleted every annotation) is indistinguishable from a wipe at the store
 * level — auto-restoring would resurrect deleted annotations.
 */
export async function loadLatestSnapshot(
  docId: string,
  before?: string,
): Promise<Annotation[] | null> {
  if (typeof window === 'undefined') return null;
  try {
    const db = await openHistDb();
    const all = await histReq<SnapshotRecord[]>(
      db.transaction(HIST_STORE, 'readonly').objectStore(HIST_STORE).getAll(),
    );
    const candidates = all
      .filter((s) => s.docId === docId && (!before || s.savedAt <= before))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return candidates.length > 0 ? candidates[0].annotations : null;
  } catch { return null; }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function filterRenderable(annotations: Annotation[], sentenceCount: number): Annotation[] {
  return annotations.filter((a) =>
    isAnchorWithinDoc(
      { startSentenceIndex: a.startSentenceIndex, endSentenceIndex: a.endSentenceIndex, selectedText: a.selectedText },
      sentenceCount,
    ),
  );
}

/** Resolve to null if the IndexedDB read hangs (stuck connection, crashed tab
 * holding a lock). A hung read must degrade to the localStorage backup, not
 * leave the reader blank forever. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// ── Server file store (durable source of truth) ───────────────────────────────
//
// One JSON file per document under ANNOTATIONS_VAULT_PATH (see
// annotation-files.ts), accessed via /api/annotations. When a server record
// exists it is authoritative: the browser stores become a cache that is healed
// to match — including shrinking, so deletions propagate instead of being
// resurrected by "richest wins". When the server is unreachable (or has no
// record yet), the browser stores carry the doc exactly as before.

const SERVER_TIMEOUT_MS = 2500;

type ServerFetchResult =
  | { ok: true; record: AnnotationStoreRecord | null }
  | { ok: false };

function canUseServer(): boolean {
  return typeof window !== 'undefined' && typeof window.fetch === 'function';
}

async function fetchServerRecord(docId: string): Promise<ServerFetchResult> {
  if (!canUseServer()) return { ok: false };
  try {
    const res = await withTimeout(
      window.fetch(`/api/annotations?docId=${encodeURIComponent(docId)}`),
      SERVER_TIMEOUT_MS,
    );
    if (!res || !res.ok) return { ok: false };
    const data = (await res.json()) as { record?: AnnotationStoreRecord | null };
    const rec = data?.record;
    if (rec && rec.version === STORAGE_VERSION && Array.isArray(rec.annotations)) {
      return { ok: true, record: rec };
    }
    return { ok: true, record: null };
  } catch {
    return { ok: false };
  }
}

/** Fire-and-forget write-through to the server file store. */
function pushServerRecord(docId: string, annotations: Annotation[], allowEmpty = false): void {
  if (!canUseServer()) return;
  try {
    void window
      .fetch('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, annotations, allowEmpty }),
      })
      .catch(() => undefined);
  } catch {
    /* best-effort */
  }
}

/**
 * One-time sweep: push every browser-stored annotation set the server doesn't
 * have yet. Run on reader startup; idempotent and cheap (one index GET, then
 * only the missing docs are posted). Never overwrites an existing server file.
 */
export async function migrateLocalAnnotationsToServer(): Promise<void> {
  if (!canUseServer()) return;
  try {
    const res = await window.fetch('/api/annotations?index=1');
    if (!res.ok) return;
    const data = (await res.json()) as { index?: Array<{ docId: string }> };
    const serverDocs = new Set((data.index ?? []).map((e) => e.docId));

    const locals = new Map<string, Annotation[]>();
    try {
      const db = await openDb();
      const all = await new Promise<AnnotationStoreRecord[]>((resolve, reject) => {
        const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAll();
        req.onsuccess = () => resolve((req.result as AnnotationStoreRecord[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      for (const r of all) {
        if (r.version === STORAGE_VERSION && Array.isArray(r.annotations)) locals.set(r.docId, r.annotations);
      }
    } catch { /* IndexedDB unavailable — localStorage scan still runs */ }
    if (hasStorage()) {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
        const docId = k.slice(STORAGE_PREFIX.length);
        const rec = readLocalBackup(docId);
        if (rec && (!locals.has(docId) || rec.annotations.length > (locals.get(docId)?.length ?? 0))) {
          locals.set(docId, rec.annotations);
        }
      }
    }

    for (const [docId, annotations] of locals) {
      if (annotations.length === 0 || serverDocs.has(docId)) continue;
      pushServerRecord(docId, annotations);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Article ids gained a `type:` prefix on 2026-07-12 so wiki/SEP versions of one
 * title stop colliding — but annotations made before that are keyed by the bare
 * slug. If the bare article record is ever lost, re-searching the article
 * creates a scoped record and the reader loads a docId the old annotations
 * aren't under (this is how 219 Human history annotations "vanished" while
 * sitting intact in the store). Maps a scoped id to its pre-scoping bare slug.
 */
function legacySlugFor(docId: string): string | null {
  const m = /^(?:wikipedia|sep|iep):(.+)$/.exec(docId);
  return m ? m[1] : null;
}

function readLocalBackup(docId: string): AnnotationStoreRecord | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(docId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnnotationStoreRecord;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.annotations)) return null;
    return parsed;
  } catch { return null; }
}

/**
 * Load annotations for a document.
 *
 * Reads BOTH stores and returns the richer one: an interrupted or raced write
 * can leave one store empty (or one record stale) while the other still holds
 * everything — returning "whichever answered first" is how the Phronesis set
 * vanished from the UI while the data sat intact in the other store. Whichever
 * side wins heals the other, so the stores reconverge.
 */
export async function loadAnnotations(docId: string): Promise<Annotation[]> {
  const [server, idbRecord] = await Promise.all([
    fetchServerRecord(docId),
    withTimeout(idbGet(docId), 2000),
  ]);

  // A server file is the durable source of truth: heal the browser cache to
  // match it (even shrinking it — deletions must propagate) and return it.
  if (server.ok && server.record) {
    const record = server.record;
    if (hasStorage()) {
      try { window.localStorage.setItem(keyFor(docId), JSON.stringify(record)); } catch { /* quota */ }
    }
    void idbPut(record);
    return record.annotations;
  }

  const idbValid =
    idbRecord && idbRecord.version === STORAGE_VERSION && Array.isArray(idbRecord.annotations)
      ? idbRecord
      : null;
  const lsRecord = readLocalBackup(docId);

  const idbAnns = idbValid?.annotations ?? null;
  const lsAnns = lsRecord?.annotations ?? null;

  // The server has no file for this doc yet (or is unreachable): browser
  // stores carry it. When the server answered "no record", push the local set
  // up so the doc migrates into the file store on first load.
  const migrateUp = (annotations: Annotation[]) => {
    if (server.ok && !server.record && annotations.length > 0) pushServerRecord(docId, annotations);
  };

  // Prefer the store with MORE annotations; tie → IndexedDB (primary).
  if (idbAnns && (!lsAnns || idbAnns.length >= lsAnns.length)) {
    if (idbAnns.length > 0 && (!lsAnns || lsAnns.length < idbAnns.length) && hasStorage()) {
      // Heal the localStorage backup from the primary.
      try { window.localStorage.setItem(keyFor(docId), JSON.stringify(idbValid)); } catch { /* quota */ }
    }
    migrateUp(idbAnns);
    return idbAnns;
  }
  if (lsAnns) {
    if (lsRecord) void idbPut(lsRecord); // heal IndexedDB from the backup
    migrateUp(lsAnns);
    return lsAnns;
  }

  // NEITHER store has ever seen this doc (an explicitly emptied doc still has a
  // record, so this can't resurrect deleted annotations). If the id is
  // type-scoped, adopt annotations saved under the pre-scoping bare slug and
  // persist them under the scoped id so future loads are direct. The legacy
  // record is left untouched.
  const legacySlug = legacySlugFor(docId);
  if (legacySlug) {
    const inherited = await loadAnnotations(legacySlug);
    if (inherited.length > 0) {
      const adopted = inherited.map((a) => ({ ...a, docId }));
      saveAnnotations(docId, adopted);
      return adopted;
    }
  }
  return [];
}

/**
 * Persist annotations: server file (durable source of truth) + localStorage
 * (sync backup) + IndexedDB (browser primary) + snapshot history.
 * `allowEmpty` marks an explicit delete-the-last-annotation so the server-side
 * wipe guard lets the empty set through.
 */
export function saveAnnotations(
  docId: string,
  annotations: Annotation[],
  options?: { allowEmpty?: boolean },
): void {
  const record: AnnotationStoreRecord = {
    version: STORAGE_VERSION,
    docId,
    annotations,
    updatedAt: new Date().toISOString(),
  };

  // Server file store (async, fire-and-forget; guarded server-side)
  pushServerRecord(docId, annotations, options?.allowEmpty === true);

  // localStorage backup (sync, best-effort)
  if (hasStorage()) {
    try { window.localStorage.setItem(keyFor(docId), JSON.stringify(record)); } catch { /* quota */ }
  }

  // IndexedDB primary (async, fire-and-forget)
  void idbPut(record);

  // Append-only history (async, best-effort) — survives any later overwrite.
  void pushSnapshot(docId, annotations);
}

/** Remove a document's annotations from all stores (explicit, so allowEmpty). */
export function clearAnnotations(docId: string): void {
  pushServerRecord(docId, [], true);
  if (hasStorage()) {
    try {
      window.localStorage.removeItem(keyFor(docId));
      window.localStorage.removeItem(pageCountKeyFor(docId));
    } catch { /* non-fatal */ }
  }
  void idbDelete(docId);
}

export async function loadValidAnnotations(docId: string, sentenceCount: number): Promise<Annotation[]> {
  return filterRenderable(await loadAnnotations(docId), sentenceCount);
}

// ── Page-count helpers (small integers, localStorage only) ────────────────────

export function loadLastWrittenPageCount(docId: string): number {
  if (!hasStorage()) return 0;
  try {
    const n = Number.parseInt(window.localStorage.getItem(pageCountKeyFor(docId)) ?? '', 10);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch { return 0; }
}

export function saveLastWrittenPageCount(docId: string, count: number): void {
  if (!hasStorage()) return;
  try { window.localStorage.setItem(pageCountKeyFor(docId), String(count)); } catch { /* non-fatal */ }
}

// ── Last-synced annotation count (wipe guard) ─────────────────────────────────
//
// Records how many annotations the last SUCCESSFUL Book_Note sync contained.
// syncBookNote uses this to refuse to overwrite a previously non-empty note
// with an empty set (which is what wiped Reading: Phronesis — a sync fired
// during navigation before the doc's annotations had loaded from IndexedDB).

function syncCountKeyFor(docId: string): string { return `${SYNCCOUNT_PREFIX}${docId}`; }

export function loadLastSyncedCount(docId: string): number {
  if (!hasStorage()) return 0;
  try {
    const n = Number.parseInt(window.localStorage.getItem(syncCountKeyFor(docId)) ?? '', 10);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch { return 0; }
}

export function saveLastSyncedCount(docId: string, count: number): void {
  if (!hasStorage()) return;
  try { window.localStorage.setItem(syncCountKeyFor(docId), String(count)); } catch { /* non-fatal */ }
}
