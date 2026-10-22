import { NextRequest, NextResponse } from 'next/server';
import { localObsidianService } from '@/lib/local-storage';
import { searchVault, vaultName, vaultRoot } from '@/lib/vault/files';

export const dynamic = 'force-dynamic';

/** GET /api/vault/search?q=text&vault=main|autodidact — full-text search across a vault's notes. */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ results: [] });
  try {
    const vault = vaultName(request.nextUrl.searchParams.get('vault'));
    const results = vault === 'main'
      ? await localObsidianService.search(q.slice(0, 200))
      : await searchVault(q.slice(0, 200), vaultRoot(vault));
    return NextResponse.json({ results: results.slice(0, 100) });
  } catch (error) {
    console.error('[vault] search failed:', error);
    return NextResponse.json({ error: 'Search failed.' }, { status: 500 });
  }
}
