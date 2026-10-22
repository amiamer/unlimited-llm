import 'server-only';

import { promises as fs } from 'fs';
import * as path from 'path';
import { atomicWrite, retryWithBackoff } from '@/lib/local-storage/file-utils';

/**
 * Raw file access for the in-app vault editor. Reads and writes markdown notes
 * byte-for-byte (frontmatter included) inside one of the vaults (main =
 * OBSIDIAN_VAULT_PATH, autodidact = IDEAVERSE_VAULT_PATH), never in
 * Obsidian's or git's own folders, and refuses to overwrite a note that changed
 * on disk since the editor loaded it.
 */

const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules']);

export class VaultPathError extends Error {}
export class VaultConflictError extends Error {
  constructor(message: string, readonly mtimeMs?: number) {
    super(message);
  }
}

export interface VaultEntry {
  path: string;
  mtimeMs: number;
  size: number;
}

export const VAULTS = { main: 'OBSIDIAN_VAULT_PATH', autodidact: 'IDEAVERSE_VAULT_PATH' } as const;
export type VaultName = keyof typeof VAULTS;

/** The vault a request names (?vault=autodidact); anything else means main. */
export function vaultName(value: unknown): VaultName {
  return value === 'autodidact' ? 'autodidact' : 'main';
}

export function vaultRoot(name: VaultName = 'main'): string {
  const key = VAULTS[name];
  const vault = process.env[key];
  if (!vault) throw new Error(`${key} is not configured.`);
  return path.resolve(vault);
}

/** Resolve a vault-relative note path to an absolute path, or throw VaultPathError. */
export function resolveVaultPath(rel: unknown, root: string = vaultRoot()): string {
  if (typeof rel !== 'string' || !rel.trim() || rel.includes('\0')) throw new VaultPathError('Invalid path.');
  const normalized = rel.trim().replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) throw new VaultPathError('Paths must be relative to the vault.');
  const parts = normalized.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) throw new VaultPathError('Invalid path.');
  if (parts.slice(0, -1).some((p) => SKIP_DIRS.has(p) || p.startsWith('.'))) {
    throw new VaultPathError('That folder is not editable here.');
  }
  if (!normalized.toLowerCase().endsWith('.md')) throw new VaultPathError('Only markdown notes can be opened here.');
  const abs = path.resolve(root, ...parts);
  const back = path.relative(root, abs);
  if (!back || back.startsWith('..') || path.isAbsolute(back)) throw new VaultPathError('Path is outside the vault.');
  return abs;
}

const toRel = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join('/');

/** Every markdown note in the vault, sorted by path. */
export async function listVault(root: string = vaultRoot()): Promise<VaultEntry[]> {
  const out: VaultEntry[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const stat = await fs.stat(abs);
        out.push({ path: toRel(root, abs), mtimeMs: stat.mtimeMs, size: stat.size });
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readVaultFile(rel: string, root: string = vaultRoot()): Promise<{ path: string; content: string; mtimeMs: number }> {
  const abs = resolveVaultPath(rel, root);
  const [content, stat] = await Promise.all([fs.readFile(abs, 'utf-8'), fs.stat(abs)]);
  return { path: toRel(root, abs), content, mtimeMs: stat.mtimeMs };
}

/**
 * Save a note. With baseMtimeMs (the version the editor loaded), refuse when
 * the file changed on disk since then, e.g. edited in Obsidian.
 */
export async function writeVaultFile(
  rel: string,
  content: string,
  baseMtimeMs?: number,
  root: string = vaultRoot(),
): Promise<{ mtimeMs: number }> {
  const abs = resolveVaultPath(rel, root);
  if (typeof baseMtimeMs === 'number') {
    const current = await fs.stat(abs).catch(() => null);
    if (!current) throw new VaultConflictError('The note was deleted or moved since you opened it.');
    if (Math.abs(current.mtimeMs - baseMtimeMs) > 1) {
      throw new VaultConflictError('The note changed on disk since you opened it.', current.mtimeMs);
    }
  }
  await retryWithBackoff(() => atomicWrite(abs, content), 3);
  return { mtimeMs: (await fs.stat(abs)).mtimeMs };
}

/** Create a new note; refuses to replace an existing one. */
export async function createVaultFile(rel: string, content = '', root: string = vaultRoot()): Promise<{ path: string; mtimeMs: number }> {
  const abs = resolveVaultPath(rel, root);
  if (await fs.stat(abs).catch(() => null)) throw new VaultConflictError('A note with that name already exists.');
  await atomicWrite(abs, content);
  return { path: toRel(root, abs), mtimeMs: (await fs.stat(abs)).mtimeMs };
}

/** Case-insensitive full-text search, one hit (first match with a line of context) per note. */
export async function searchVault(query: string, root: string = vaultRoot()): Promise<{ file: string; context: string }[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: { file: string; context: string }[] = [];
  for (const entry of await listVault(root)) {
    const lines = (await fs.readFile(path.join(root, ...entry.path.split('/')), 'utf-8')).split(/\r?\n/);
    const i = lines.findIndex((line) => line.toLowerCase().includes(needle));
    if (i === -1 && !entry.path.toLowerCase().includes(needle)) continue;
    const at = Math.max(i, 0);
    results.push({ file: entry.path, context: lines.slice(Math.max(at - 1, 0), at + 2).join('\n').trim() });
  }
  return results;
}
