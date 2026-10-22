/**
 * Knowledge Map — Obsidian Canvas reader.
 * Feature: knowledge-map
 *
 *   GET  /api/knowledge-map/canvases            → list every .canvas in the vault
 *   GET  /api/knowledge-map/canvases?file=REL   → read one canvas (raw JSONCanvas)
 *
 * Reads are confined to the configured Obsidian vault; any path that escapes it
 * (or isn't a .canvas) is rejected. The Timeline view consumes these.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';

const VAULT = process.env.OBSIDIAN_VAULT_PATH;

interface CanvasListItem {
  /** Vault-relative path with forward slashes (the handle for read/write). */
  file: string;
  /** Display name (filename without extension). */
  name: string;
}

/** Resolve a vault-relative file to an absolute path, or null if it escapes. */
function resolveInVault(vault: string, rel: string): string | null {
  if (!rel || !rel.toLowerCase().endsWith('.canvas')) return null;
  const abs = path.resolve(vault, rel);
  const root = path.resolve(vault);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

async function findCanvases(dir: string, root: string, out: CanvasListItem[]): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // skip .obsidian, .trash, etc.
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await findCanvases(full, root, out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.canvas')) {
      const rel = path.relative(root, full).split(path.sep).join('/');
      out.push({ file: rel, name: e.name.replace(/\.canvas$/i, '') });
    }
  }
}

export async function GET(request: NextRequest) {
  if (!VAULT) {
    return NextResponse.json({ error: 'OBSIDIAN_VAULT_PATH not configured' }, { status: 503 });
  }
  const file = request.nextUrl.searchParams.get('file');

  // Read one canvas.
  if (file) {
    const abs = resolveInVault(VAULT, file);
    if (!abs) return NextResponse.json({ error: 'Invalid canvas path' }, { status: 400 });
    try {
      const raw = await fs.readFile(abs, 'utf-8');
      return NextResponse.json({ file, canvas: JSON.parse(raw) });
    } catch {
      return NextResponse.json({ error: 'Canvas not found or unreadable' }, { status: 404 });
    }
  }

  // List all canvases.
  const out: CanvasListItem[] = [];
  await findCanvases(VAULT, VAULT, out);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ canvases: out });
}
