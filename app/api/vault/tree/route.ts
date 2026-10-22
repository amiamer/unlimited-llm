import { NextRequest, NextResponse } from 'next/server';
import { listVault, vaultName, vaultRoot } from '@/lib/vault/files';

export const dynamic = 'force-dynamic';

/**
 * GET /api/vault/tree?vault=main|autodidact — every markdown note in the vault (path, mtime, size),
 * plus the vault's folder (for "open in Obsidian" links on this computer).
 */
export async function GET(request: NextRequest) {
  try {
    const root = vaultRoot(vaultName(request.nextUrl.searchParams.get('vault')));
    return NextResponse.json({ files: await listVault(root), root });
  } catch (error) {
    console.error('[vault] tree failed:', error);
    return NextResponse.json({ error: 'Could not list the vault.' }, { status: 500 });
  }
}
