import { NextResponse } from 'next/server';
import { readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';

/**
 * List all available EPUB books on disk
 * GET /api/reader/books
 *
 * Scans BOOKS_PATH for .epub files.
 * This allows the frontend to rebuild sessions from disk state
 * when localStorage is cleared.
 */

const BOOKS_PATH = process.env.BOOKS_PATH || './books';

export async function GET() {
  try {
    if (!existsSync(BOOKS_PATH)) {
      return NextResponse.json({ books: [], count: 0 });
    }

    const entries = await readdir(BOOKS_PATH, { withFileTypes: true });
    const epubFiles = entries.filter(
      (e) => e.isFile() && e.name.toLowerCase().endsWith('.epub')
    );

    const books = await Promise.all(
      epubFiles.map(async (entry) => {
        const title = entry.name.replace(/\.epub$/i, '');
        const sanitizedId = title.replace(/[<>:"/\\|?*]/g, '_');
        const servingUrl = `/api/reader/serve/${encodeURIComponent(entry.name)}`;

        return {
          id: sanitizedId,
          title,
          fileName: entry.name,
          servingUrl,
        };
      })
    );

    return NextResponse.json({
      books: books.sort((a, b) => a.title.localeCompare(b.title)),
      count: books.length,
    });
  } catch (error) {
    console.error('Error listing books:', error);
    return NextResponse.json(
      { error: 'Failed to list books' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/reader/books?filename=My+Book.epub
 * Removes the EPUB file.
 */
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('filename') ?? '';
  const filename = basename(raw);
  if (!filename || !filename.toLowerCase().endsWith('.epub')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  const epubPath = join(BOOKS_PATH, filename);
  if (!existsSync(epubPath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    await unlink(epubPath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('EPUB delete error:', error);
    return NextResponse.json({ error: 'Failed to delete EPUB' }, { status: 500 });
  }
}
