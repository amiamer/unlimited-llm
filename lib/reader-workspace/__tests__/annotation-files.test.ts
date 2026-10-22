/**
 * Server-side annotation file store.
 * Feature: reader-workspace
 *
 * The durable source of truth: one JSON file per doc, wipe-guarded writes,
 * rotating .history/ archive.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  annotationsDir,
  fileNameFor,
  docIdFromFileName,
  isValidDocId,
  readAnnotationFile,
  writeAnnotationFile,
  listAnnotationFiles,
} from '../annotation-files';
import type { Annotation } from '../types';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ann-files-'));
  process.env.ANNOTATIONS_VAULT_PATH = dir;
});

afterEach(async () => {
  delete process.env.ANNOTATIONS_VAULT_PATH;
  await fs.rm(dir, { recursive: true, force: true });
});

function ann(docId: string, comment: string): Annotation {
  const ts = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    docId,
    startSentenceIndex: 0,
    endSentenceIndex: 1,
    selectedText: 'passage',
    comment,
    aiReplies: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

describe('annotation-files', () => {
  it('uses the env-configured directory', () => {
    expect(annotationsDir()).toBe(dir);
  });

  it('file names are reversible and Windows-safe for scoped ids', () => {
    const docId = 'wikipedia:Human history';
    const name = fileNameFor(docId);
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
    expect(docIdFromFileName(name)).toBe(docId);
  });

  it('rejects path-traversal and malformed docIds', () => {
    expect(isValidDocId('..')).toBe(false);
    expect(isValidDocId('a/../b')).toBe(false);
    expect(isValidDocId('a\\b')).toBe(false);
    expect(isValidDocId('')).toBe(false);
    expect(isValidDocId('   ')).toBe(false);
    expect(isValidDocId(null)).toBe(false);
    expect(isValidDocId('wikipedia:Human history')).toBe(true);
  });

  it('round-trips a record', async () => {
    const docId = 'wikipedia:Human history';
    const result = await writeAnnotationFile(docId, [ann(docId, 'note')]);
    expect(result.ok).toBe(true);

    const read = await readAnnotationFile(docId);
    expect(read).not.toBeNull();
    expect(read!.docId).toBe(docId);
    expect(read!.annotations).toHaveLength(1);
    expect(read!.annotations[0].comment).toBe('note');
  });

  it('missing file reads as null', async () => {
    await expect(readAnnotationFile('never-written')).resolves.toBeNull();
  });

  it('wipe guard: refuses an empty set over a non-empty file', async () => {
    const docId = 'doc';
    await writeAnnotationFile(docId, [ann(docId, 'keep me')]);

    const result = await writeAnnotationFile(docId, []);

    expect(result).toEqual({ ok: true, skipped: true });
    const read = await readAnnotationFile(docId);
    expect(read!.annotations).toHaveLength(1);
  });

  it('allowEmpty writes the empty set through', async () => {
    const docId = 'doc';
    await writeAnnotationFile(docId, [ann(docId, 'deleted soon')]);

    const result = await writeAnnotationFile(docId, [], { allowEmpty: true });

    expect(result.ok).toBe(true);
    expect((await readAnnotationFile(docId))!.annotations).toHaveLength(0);
  });

  it('every overwrite archives the previous file to .history', async () => {
    const docId = 'doc';
    await writeAnnotationFile(docId, [ann(docId, 'v1')]);
    await writeAnnotationFile(docId, [ann(docId, 'v1'), ann(docId, 'v2')]);

    const hist = await fs.readdir(path.join(dir, '.history'));
    expect(hist).toHaveLength(1);
    const archived = JSON.parse(await fs.readFile(path.join(dir, '.history', hist[0]), 'utf-8'));
    expect(archived.annotations).toHaveLength(1);
    expect(archived.annotations[0].comment).toBe('v1');
  });

  it('history is pruned to the retention cap', async () => {
    const docId = 'doc';
    for (let i = 0; i <= 13; i++) {
      // Distinct timestamps: the archive name has second precision via ISO.
      await writeAnnotationFile(docId, Array.from({ length: i + 1 }, (_, j) => ann(docId, `v${j}`)));
      await new Promise((r) => setTimeout(r, 2));
    }
    const hist = await fs.readdir(path.join(dir, '.history'));
    expect(hist.length).toBeLessThanOrEqual(10);
  });

  it('listAnnotationFiles indexes every stored doc', async () => {
    await writeAnnotationFile('a', [ann('a', 'x')]);
    await writeAnnotationFile('wikipedia:B', [ann('wikipedia:B', 'y'), ann('wikipedia:B', 'z')]);

    const index = await listAnnotationFiles();

    expect(index).toHaveLength(2);
    const byId = Object.fromEntries(index.map((e) => [e.docId, e.count]));
    expect(byId['a']).toBe(1);
    expect(byId['wikipedia:B']).toBe(2);
  });

  it('listAnnotationFiles returns [] when the directory does not exist', async () => {
    process.env.ANNOTATIONS_VAULT_PATH = path.join(dir, 'nope');
    await expect(listAnnotationFiles()).resolves.toEqual([]);
  });
});
