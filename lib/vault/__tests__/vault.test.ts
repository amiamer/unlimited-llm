import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createVaultFile,
  listVault,
  readVaultFile,
  resolveVaultPath,
  VaultConflictError,
  VaultPathError,
  writeVaultFile,
} from '../files';
import { buildNoteIndex, resolveWikilink, splitFrontmatter, wikilinksToMarkdown, WIKILINK_SCHEME } from '../wikilinks';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'vault-'));
  await mkdir(path.join(root, 'notes', 'deep'), { recursive: true });
  await mkdir(path.join(root, '.obsidian'), { recursive: true });
  await writeFile(path.join(root, 'Home.md'), '---\ntags: [x]\n---\n# Home\n');
  await writeFile(path.join(root, 'notes', 'Idea.md'), 'idea');
  await writeFile(path.join(root, 'notes', 'deep', 'Idea.md'), 'deep idea');
  await writeFile(path.join(root, 'notes', 'image.png'), 'png');
  await writeFile(path.join(root, '.obsidian', 'workspace.md'), 'internal');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('resolveVaultPath', () => {
  it('accepts markdown paths inside the vault', () => {
    expect(resolveVaultPath('notes/Idea.md', root)).toBe(path.join(root, 'notes', 'Idea.md'));
    expect(resolveVaultPath('notes\\Idea.md', root)).toBe(path.join(root, 'notes', 'Idea.md'));
  });

  it('refuses traversal, absolute paths, hidden folders and non-markdown files', () => {
    for (const bad of ['../secret.md', 'notes/../../x.md', '/etc/passwd.md', 'C:/x.md', '.obsidian/workspace.md', '.git/config.md', 'notes/image.png', '', 'notes//x.md']) {
      expect(() => resolveVaultPath(bad, root), bad).toThrow(VaultPathError);
    }
  });
});

describe('vault files', () => {
  it('lists markdown notes only, skipping Obsidian and git folders', async () => {
    const files = await listVault(root);
    expect(files.map((f) => f.path)).toEqual(['Home.md', 'notes/deep/Idea.md', 'notes/Idea.md']);
  });

  it('reads notes byte-for-byte, frontmatter included', async () => {
    const note = await readVaultFile('Home.md', root);
    expect(note.content).toBe('---\ntags: [x]\n---\n# Home\n');
    expect(note.mtimeMs).toBeGreaterThan(0);
  });

  it('saves when the note is unchanged on disk and refuses when it changed', async () => {
    const { mtimeMs } = await readVaultFile('notes/Idea.md', root);
    const saved = await writeVaultFile('notes/Idea.md', 'idea v2', mtimeMs, root);
    expect(await readFile(path.join(root, 'notes', 'Idea.md'), 'utf-8')).toBe('idea v2');

    // Someone else (Obsidian) edits the note afterwards.
    await writeFile(path.join(root, 'notes', 'Idea.md'), 'edited in obsidian');
    const later = new Date(saved.mtimeMs + 5000);
    await utimes(path.join(root, 'notes', 'Idea.md'), later, later);
    await expect(writeVaultFile('notes/Idea.md', 'stale edit', saved.mtimeMs, root)).rejects.toBeInstanceOf(VaultConflictError);
    expect(await readFile(path.join(root, 'notes', 'Idea.md'), 'utf-8')).toBe('edited in obsidian');

    // Without a base version (explicit overwrite) it saves.
    await writeVaultFile('notes/Idea.md', 'keep mine', undefined, root);
    expect(await readFile(path.join(root, 'notes', 'Idea.md'), 'utf-8')).toBe('keep mine');
  });

  it('creates new notes (and folders) but never replaces an existing one', async () => {
    const created = await createVaultFile('new/Fresh.md', '# fresh', root);
    expect(created.path).toBe('new/Fresh.md');
    expect(await readFile(path.join(root, 'new', 'Fresh.md'), 'utf-8')).toBe('# fresh');
    await expect(createVaultFile('Home.md', 'x', root)).rejects.toBeInstanceOf(VaultConflictError);
  });
});

describe('wikilinks', () => {
  const index = buildNoteIndex(['Home.md', 'notes/Idea.md', 'notes/deep/Idea.md', 'projects/Plan.md']);

  it('resolves by note name, by path, and prefers the linking note’s folder on a clash', () => {
    expect(resolveWikilink('home', index)).toBe('Home.md');
    expect(resolveWikilink('projects/Plan', index)).toBe('projects/Plan.md');
    expect(resolveWikilink('Idea', index, 'notes/deep/Other.md')).toBe('notes/deep/Idea.md');
    expect(resolveWikilink('Idea', index, 'Home.md')).toBe('notes/Idea.md');
    expect(resolveWikilink('Missing', index)).toBeNull();
  });

  it('turns wikilinks into links, keeping aliases and leaving code alone', () => {
    const md = wikilinksToMarkdown('See [[Idea]] and [[projects/Plan|the plan]] or [[Home#Top]]. `[[not a link]]`\n```\n[[also not]]\n```');
    expect(md).toContain(`[Idea](${WIKILINK_SCHEME}Idea)`);
    expect(md).toContain(`[the plan](${WIKILINK_SCHEME}${encodeURIComponent('projects/Plan')})`);
    expect(md).toContain(`[Home#Top](${WIKILINK_SCHEME}Home)`);
    expect(md).toContain('`[[not a link]]`');
    expect(md).toContain('[[also not]]');
  });

  it('splits off frontmatter', () => {
    expect(splitFrontmatter('---\na: 1\n---\nbody')).toEqual({ frontmatter: 'a: 1', body: 'body' });
    expect(splitFrontmatter('no frontmatter')).toEqual({ frontmatter: null, body: 'no frontmatter' });
  });
});
