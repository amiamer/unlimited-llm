/**
 * Unified reader — server-side article library.
 *
 * Saved articles (Wikipedia/SEP/IEP) used to live only in the browser's
 * IndexedDB, so a second browser or machine started with an empty Library.
 * The durable copy is now one JSON file per article under
 * `<CHAT_VAULT_PATH>/reader-library` (fallback `<cwd>/data/reader-library`),
 * next to the annotation files, so it syncs between machines the same way.
 * The full article text is kept so annotations anchor to the same text
 * everywhere. Removing an article leaves a small tombstone, so a browser that
 * still has it cached drops it instead of uploading it again.
 *
 * SERVER-ONLY: imports node:fs. Client access goes through /api/reader/articles.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { atomicWrite, ensureDirectory } from '../local-storage/file-utils';
import { docIdFromFileName, fileNameFor, isValidDocId } from '../reader-workspace/annotation-files';
import type { ReadingSourceType } from './types';

export interface ArticleFileRecord {
  id: string;
  type: ReadingSourceType;
  title: string;
  content: string;
  url?: string;
  savedAt: number;
  removed?: boolean;
}

export const isValidArticleId = isValidDocId;

export function articlesDir(): string {
  if (process.env.CHAT_VAULT_PATH) return path.join(process.env.CHAT_VAULT_PATH, 'reader-library');
  return path.join(process.cwd(), 'data', 'reader-library');
}

const filePathFor = (id: string) => path.join(articlesDir(), fileNameFor(id));

/** Every article file, tombstones included, newest first. */
export async function listArticleFiles(): Promise<ArticleFileRecord[]> {
  let names: string[];
  try {
    names = await fs.readdir(articlesDir());
  } catch {
    return [];
  }
  const out: ArticleFileRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = JSON.parse(await fs.readFile(path.join(articlesDir(), name), 'utf-8')) as ArticleFileRecord;
      out.push({ ...record, id: docIdFromFileName(name) });
    } catch { /* skip unreadable files, e.g. mid-sync */ }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export async function readArticleFile(id: string): Promise<ArticleFileRecord | null> {
  try {
    const record = JSON.parse(await fs.readFile(filePathFor(id), 'utf-8')) as ArticleFileRecord;
    return record.removed ? null : { ...record, id };
  } catch {
    return null;
  }
}

/** Save an article; never resurrects one that was removed unless `restore`. */
export async function writeArticleFile(record: ArticleFileRecord, opts: { restore?: boolean } = {}): Promise<{ ok: boolean; removed?: boolean }> {
  if (!opts.restore) {
    try {
      const existing = JSON.parse(await fs.readFile(filePathFor(record.id), 'utf-8')) as ArticleFileRecord;
      if (existing.removed) return { ok: false, removed: true };
      if (existing.content) return { ok: true };
    } catch { /* new article */ }
  }
  await ensureDirectory(articlesDir());
  const { id, type, title, content, url, savedAt } = record;
  await atomicWrite(filePathFor(id), JSON.stringify({ id, type, title, content, url, savedAt }));
  return { ok: true };
}

/** Replace an article with a tombstone. */
export async function removeArticleFile(id: string): Promise<void> {
  await ensureDirectory(articlesDir());
  await atomicWrite(filePathFor(id), JSON.stringify({ id, removed: true, savedAt: Date.now() }));
}
