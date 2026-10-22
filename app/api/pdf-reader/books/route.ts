import { NextResponse } from 'next/server';
import { readdir, stat, unlink } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';

/**
 * List PDF books with extraction status
 * GET /api/pdf-reader/books
 */

const BOOKS_PATH = process.env.BOOKS_PATH || './books';

export async function GET() {
  try {
    if (!existsSync(BOOKS_PATH)) {
      return NextResponse.json({ books: [], count: 0 });
    }

    const entries = await readdir(BOOKS_PATH, { withFileTypes: true });
    const pdfFiles = entries.filter(
      (e) => e.isFile() && e.name.toLowerCase().endsWith('.pdf')
    );

    const extractsDir = join(BOOKS_PATH, 'pdf-extracts');

    const books = await Promise.all(
      pdfFiles.map(async (entry) => {
        const title = entry.name.replace(/\.pdf$/i, '');
        const sanitizedId = title.replace(/[<>:"/\\|?*]/g, '_');
        const extractPath = join(extractsDir, `${sanitizedId}.json`);

        let extracted = false;
        let extractedAt: string | null = null;

        if (existsSync(extractPath)) {
          extracted = true;
          try {
            const s = await stat(extractPath);
            extractedAt = s.mtime.toISOString();
          } catch {
            // ignore
          }
        }

        return {
          filename: entry.name,
          title,
          extracted,
          extractedAt,
        };
      })
    );

    return NextResponse.json({ books, count: books.length });
  } catch (error) {
    console.error('PDF books list error:', error);
    return NextResponse.json({ error: 'Failed to list PDFs' }, { status: 500 });
  }
}

/**
 * DELETE /api/pdf-reader/books?filename=My+Book.pdf
 * Removes the PDF and its extract JSON (if present).
 */
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('filename') ?? '';
  const filename = basename(raw); // strip any path traversal
  if (!filename || !filename.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  const pdfPath = join(BOOKS_PATH, filename);
  if (!existsSync(pdfPath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    await unlink(pdfPath);

    const sanitizedId = filename.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*]/g, '_');
    const extractPath = join(BOOKS_PATH, 'pdf-extracts', `${sanitizedId}.json`);
    if (existsSync(extractPath)) await unlink(extractPath);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('PDF delete error:', error);
    return NextResponse.json({ error: 'Failed to delete PDF' }, { status: 500 });
  }
}
