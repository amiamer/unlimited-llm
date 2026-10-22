/**
 * Reader Workspace — server-side annotation file store.
 * Feature: reader-workspace
 *
 * The durable source of truth for annotations: one JSON file per document
 * under ANNOTATIONS_VAULT_PATH (default `<CHAT_VAULT_PATH>/annotations`,
 * final fallback `<cwd>/data/annotations`). Browser storage (IndexedDB /
 * localStorage) is a cache of these files — clearing browser data can no
 * longer lose annotations.
 *
 * Server-side wipe insurance, mirroring the browser-side guards:
 * - writeAnnotationFile refuses to overwrite a non-empty file with an empty
 *   set unless `allowEmpty` (an explicit delete-the-last-annotation).
 * - Every overwrite first archives the previous file to `.history/`
 *   (rotating, last HISTORY_KEEP per doc).
 *
 * SERVER-ONLY: imports node:fs — must never be imported from client code.
 * Client access goes through /api/annotations.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { atomicWrite, ensureDirectory } from '../local-storage/file-utils';
import type { Annotation } from './types';

export interface AnnotationFileRecord {
  version: number;
  docId: string;
  annotations: Annotation[];
  updatedAt: string;
}

export interface AnnotationIndexEntry {
  docId: string;
  count: number;
  updatedAt: string;
}

const FILE_VERSION = 1;
const HISTORY_DIR = '.history';
const HISTORY_KEEP = 10;

export function annotationsDir(): string {
  if (process.env.ANNOTATIONS_VAULT_PATH) return process.env.ANNOTATIONS_VAULT_PATH;
  if (process.env.CHAT_VAULT_PATH) return path.join(process.env.CHAT_VAULT_PATH, 'annotations');
  return path.join(process.cwd(), 'data', 'annotations');
}

/**
 * docId → filename. encodeURIComponent makes every path separator and almost
 * every Windows-illegal character safe and is losslessly reversible; `*` is
 * the one illegal character it leaves, so it is encoded explicitly.
 */
export function fileNameFor(docId: string): string {
  return `${encodeURIComponent(docId).replace(/\*/g, '%2A')}.json`;
}

export function docIdFromFileName(fileName: string): string {
  return decodeURIComponent(fileName.replace(/\.json$/, ''));
}

/** Reject ids that are empty, absurdly long, or path-traversal shaped. */
export function isValidDocId(docId: unknown): docId is string {
  return (
    typeof docId === 'string' &&
    docId.trim().length > 0 &&
    docId.length <= 300 &&
    !docId.includes('/') &&
    !docId.includes('\\') &&
    !docId.includes('..')
  );
}

function filePathFor(docId: string): string {
  return path.join(annotationsDir(), fileNameFor(docId));
}

export async function readAnnotationFile(docId: string): Promise<AnnotationFileRecord | null> {
  try {
    const raw = await fs.readFile(filePathFor(docId), 'utf-8');
    const parsed = JSON.parse(raw) as AnnotationFileRecord;
    if (parsed.version !== FILE_VERSION || !Array.isArray(parsed.annotations)) return null;
    return parsed;
  } catch {
    return null; // missing or unreadable → treated as "no record"
  }
}

/** Archive the current file into `.history/` and prune beyond HISTORY_KEEP. */
async function archiveExisting(docId: string): Promise<void> {
  const src = filePathFor(docId);
  try {
    await fs.access(src);
  } catch {
    return; // nothing to archive
  }
  try {
    const histDir = path.join(annotationsDir(), HISTORY_DIR);
    await ensureDirectory(histDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = fileNameFor(docId).replace(/\.json$/, '');
    await fs.copyFile(src, path.join(histDir, `${base}.${stamp}.json`));
    const entries = (await fs.readdir(histDir))
      .filter((f) => f.startsWith(`${base}.`) && f.endsWith('.json'))
      .sort(); // ISO stamps sort chronologically
    for (const stale of entries.slice(0, Math.max(0, entries.length - HISTORY_KEEP))) {
      await fs.unlink(path.join(histDir, stale)).catch(() => undefined);
    }
  } catch {
    /* history is best-effort — never blocks the write */
  }
}

export type WriteResult =
  | { ok: true; record: AnnotationFileRecord }
  | { ok: true; skipped: true }
  | { ok: false; error: string };

export async function writeAnnotationFile(
  docId: string,
  annotations: Annotation[],
  options?: { allowEmpty?: boolean },
): Promise<WriteResult> {
  try {
    await ensureDirectory(annotationsDir());
    const existing = await readAnnotationFile(docId);
    // Wipe guard: an empty set may not silently replace a non-empty file.
    if (annotations.length === 0 && !options?.allowEmpty && existing && existing.annotations.length > 0) {
      console.warn('[annotation-files] skipped empty-set write for', docId, '(wipe guard)');
      return { ok: true, skipped: true };
    }
    await archiveExisting(docId);
    const record: AnnotationFileRecord = {
      version: FILE_VERSION,
      docId,
      annotations,
      updatedAt: new Date().toISOString(),
    };
    await atomicWrite(filePathFor(docId), JSON.stringify(record, null, 1));
    return { ok: true, record };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Lightweight listing of every stored doc (for the client migration sweep). */
export async function listAnnotationFiles(): Promise<AnnotationIndexEntry[]> {
  try {
    const files = (await fs.readdir(annotationsDir())).filter((f) => f.endsWith('.json'));
    const out: AnnotationIndexEntry[] = [];
    for (const f of files) {
      try {
        const raw = await fs.readFile(path.join(annotationsDir(), f), 'utf-8');
        const parsed = JSON.parse(raw) as AnnotationFileRecord;
        if (parsed.version === FILE_VERSION && Array.isArray(parsed.annotations)) {
          out.push({ docId: parsed.docId, count: parsed.annotations.length, updatedAt: parsed.updatedAt });
        }
      } catch {
        /* skip unreadable file */
      }
    }
    return out;
  } catch {
    return []; // directory missing → nothing stored yet
  }
}
