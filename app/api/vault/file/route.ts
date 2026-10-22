import { NextRequest, NextResponse } from 'next/server';
import {
  createVaultFile,
  readVaultFile,
  VaultConflictError,
  VaultPathError,
  vaultName,
  vaultRoot,
  writeVaultFile,
} from '@/lib/vault/files';

export const dynamic = 'force-dynamic';

const MAX_NOTE_BYTES = 5 * 1024 * 1024;

function failure(error: unknown, action: string) {
  if (error instanceof VaultPathError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof VaultConflictError) {
    return NextResponse.json({ error: error.message, conflict: true, mtimeMs: error.mtimeMs }, { status: 409 });
  }
  if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return NextResponse.json({ error: 'Note not found.' }, { status: 404 });
  console.error(`[vault] ${action} failed:`, error);
  return NextResponse.json({ error: `Could not ${action} the note.` }, { status: 500 });
}

/** The vault named by ?vault= (main when absent). */
const rootOf = (request: NextRequest) => vaultRoot(vaultName(request.nextUrl.searchParams.get('vault')));

async function body(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** GET /api/vault/file?path=folder/Note.md — raw note text plus its mtime. */
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(await readVaultFile(request.nextUrl.searchParams.get('path') ?? '', rootOf(request)));
  } catch (error) {
    return failure(error, 'read');
  }
}

/**
 * PUT /api/vault/file { path, content, baseMtimeMs? } — save. With
 * baseMtimeMs, a note changed on disk since it was opened answers 409.
 */
export async function PUT(request: NextRequest) {
  const input = await body(request);
  if (!input || typeof input.content !== 'string') return NextResponse.json({ error: 'Missing content.' }, { status: 400 });
  if (Buffer.byteLength(input.content) > MAX_NOTE_BYTES) return NextResponse.json({ error: 'Note is too large.' }, { status: 413 });
  try {
    const base = typeof input.baseMtimeMs === 'number' ? input.baseMtimeMs : undefined;
    return NextResponse.json(await writeVaultFile(String(input.path ?? ''), input.content, base, rootOf(request)));
  } catch (error) {
    return failure(error, 'save');
  }
}

/** POST /api/vault/file { path, content? } — create a new note (never replaces one). */
export async function POST(request: NextRequest) {
  const input = await body(request);
  if (!input) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const content = typeof input.content === 'string' ? input.content : '';
  try {
    return NextResponse.json(await createVaultFile(String(input.path ?? ''), content, rootOf(request)), { status: 201 });
  } catch (error) {
    return failure(error, 'create');
  }
}
