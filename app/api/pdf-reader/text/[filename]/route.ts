import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Serve extracted PDF text
 * GET /api/pdf-reader/text/[filename]
 */

const BOOKS_PATH = process.env.BOOKS_PATH || './books';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    const decoded = decodeURIComponent(filename);

    // Sanitize — prevent path traversal
    if (decoded.includes('..') || decoded.includes('/') || decoded.includes('\\')) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    const baseName = decoded.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*]/g, '_');
    const extractPath = join(BOOKS_PATH, 'pdf-extracts', `${baseName}.json`);

    if (!existsSync(extractPath)) {
      return NextResponse.json(
        { error: 'Text not extracted yet. Upload the PDF or re-extract.' },
        { status: 404 }
      );
    }

    const content = await readFile(extractPath, 'utf-8');
    const data = JSON.parse(content);

    return NextResponse.json(data);
  } catch (error) {
    console.error('PDF text serve error:', error);
    return NextResponse.json({ error: 'Failed to read extracted text' }, { status: 500 });
  }
}
