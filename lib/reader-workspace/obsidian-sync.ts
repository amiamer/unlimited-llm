/**
 * Reader Workspace — Obsidian Book_Note sync.
 * Feature: reader-workspace
 *
 * Regenerates the full Book_Note page set from the current local annotation
 * set and persists it to the Obsidian note endpoint, one POST per page.
 *
 * Single-note-per-page semantics: the service derives the note filename
 * deterministically from the title and overwrites on each sync.
 *
 * Stale trailing pages: when the page count shrinks (e.g. after deletes or
 * after the limit raise that collapsed 5 pages into 1), pages beyond the new
 * count are DELETED from the vault. A defensive ceiling of 10 is used so that
 * orphaned pages from failed earlier syncs (whose count was never saved) are
 * also swept on the first successful run.
 *
 * Never throws — resolves to a status the UI surfaces in-thread (Req 6.9/8.9).
 */

import type { Annotation } from './types';
import { buildBookNotePages, bookNotePageTitle } from './book-note';
import {
  loadLastWrittenPageCount,
  saveLastWrittenPageCount,
  loadLastSyncedCount,
  saveLastSyncedCount,
} from './annotation-store';
import { loadAllSummaries } from './summary-store';

export interface SyncResult {
  ok: boolean;
  error?: string;
  /** Number of content pages written this sync. */
  pageCount: number;
  /** True when the wipe guard refused an empty-set overwrite (nothing written). */
  skipped?: boolean;
}

export interface SyncOptions {
  /**
   * Allow syncing an EMPTY annotation set over a previously non-empty note.
   * Only the explicit delete path sets this — everywhere else, an empty set
   * reaching the sync means the doc's annotations haven't loaded yet, and
   * writing would wipe the note (regenerate-from-scratch semantics).
   */
  allowEmpty?: boolean;
}

const OBSIDIAN_NOTE_ENDPOINT = '/api/obsidian/note';

/** POST a single page task; returns true on a 2xx response. */
async function postTask(task: string): Promise<boolean> {
  try {
    const res = await fetch(OBSIDIAN_NOTE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task }),
    });
    if (!res.ok) {
      const err = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
      console.error('[obsidian-sync] POST failed:', res.status, err, 'task title:', task.split('\n')[0]);
    }
    return res.ok;
  } catch (e) {
    console.error('[obsidian-sync] fetch error:', e);
    return false;
  }
}

/** DELETE a stale page note by title. Returns true even on 404 (already gone). */
async function deleteStaleNote(title: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${OBSIDIAN_NOTE_ENDPOINT}?title=${encodeURIComponent(title)}`,
      { method: 'DELETE' },
    );
    return res.ok || res.status === 404;
  } catch (e) {
    console.error('[obsidian-sync] DELETE failed:', e);
    return false;
  }
}

// How many pages to defensively sweep on the first sync (when previousCount is
// unknown or stale). Handles orphans left by earlier failed/rate-limited syncs.
const DEFENSIVE_SWEEP_CEILING = 10;

/**
 * Regenerate and persist the Book_Note for a document.
 *
 * - Posts one request per current page under its stable title.
 * - Empties any previously-written pages beyond the new page count.
 * - Records the new page count on overall success.
 *
 * @returns aggregate status; `ok` is false if ANY page or cleanup write failed.
 */
export async function syncBookNote(
  docId: string,
  docTitle: string,
  annotations: Annotation[],
  options?: SyncOptions,
): Promise<SyncResult> {
  // WIPE GUARD: never regenerate a previously non-empty note from an empty
  // set unless the caller explicitly deleted the last annotation. An empty
  // set here otherwise means the annotations for this doc haven't finished
  // loading (e.g. a summary-strip commit firing mid-navigation) — writing
  // would erase the note's content while the real data sits in IndexedDB.
  if (annotations.length === 0 && !options?.allowEmpty && loadLastSyncedCount(docId) > 0) {
    console.warn('[obsidian-sync] skipped empty-set sync for', docId, '(wipe guard)');
    return { ok: true, pageCount: 0, skipped: true };
  }

  // Include the reader's running per-chapter summaries (read fresh from the
  // store) so the Book_Note always carries the latest summary section.
  const summaries = loadAllSummaries(docId);
  const pages = buildBookNotePages(docTitle, annotations, summaries);
  const previousCount = loadLastWrittenPageCount(docId);

  let allOk = true;

  // Write current pages.
  for (const page of pages) {
    const ok = await postTask(page.task);
    if (!ok) allOk = false;
  }

  // Delete stale trailing pages. Sweep only up to what we last wrote, so a note
  // whose page count is stable triggers ZERO deletes on each save (no more 9
  // DELETE calls every time you add a comment). On the very first sync of a
  // session (previousCount unknown) do one defensive sweep to the ceiling to
  // clear orphans left by earlier untracked/failed runs.
  const cleanupCeiling = previousCount === 0
    ? DEFENSIVE_SWEEP_CEILING
    : previousCount;
  for (let pageNum = pages.length + 1; pageNum <= cleanupCeiling; pageNum++) {
    const title = bookNotePageTitle(docTitle, pageNum);
    const ok = await deleteStaleNote(title); // 404 = already gone = ok
    if (!ok) allOk = false;
  }

  // Only record the new counts when everything succeeded, so a failed sync
  // leaves the previous counts intact and a retry will still clean up stragglers.
  if (allOk) {
    saveLastWrittenPageCount(docId, pages.length);
    saveLastSyncedCount(docId, annotations.length);
  }

  return {
    ok: allOk,
    error: allOk ? undefined : 'One or more Book_Note pages failed to save',
    pageCount: pages.length,
  };
}
