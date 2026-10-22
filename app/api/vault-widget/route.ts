import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
    if (!vaultPath) {
      return NextResponse.json({ error: 'Vault path not configured' }, { status: 200 });
    }

    const file = request.nextUrl.searchParams.get('file');
    if (!file) {
      return NextResponse.json({ error: 'File parameter required' }, { status: 400 });
    }

    // Security: reject path traversal
    if (file.includes('..')) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    const fullPath = path.join(vaultPath, file);
    const resolved = path.resolve(fullPath);
    const resolvedVault = path.resolve(vaultPath);

    // Ensure resolved path is within vault
    if (!resolved.startsWith(resolvedVault)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ error: 'File not found', content: null }, { status: 200 });
    }

    const content = fs.readFileSync(resolved, 'utf-8');
    return NextResponse.json({ content });
  } catch (error) {
    console.error('Vault widget error:', error);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
