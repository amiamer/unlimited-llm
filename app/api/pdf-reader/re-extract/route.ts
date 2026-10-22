import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import http from 'http';

/**
 * Re-extract text from an already-uploaded PDF
 * POST /api/pdf-reader/re-extract
 * Body: { filename: string }
 *
 * Uses Node http module instead of fetch to avoid undici's headersTimeout
 * which kills long-running OCR requests after ~5 minutes.
 */

const BOOKS_PATH = process.env.BOOKS_PATH || './books';
const PDF_SERVER_URL = process.env.PDF_SERVER_URL || 'http://localhost:8100';

export const maxDuration = 1800;

/** POST a file to the Surya OCR service using raw http (no undici timeout) */
function postToSurya(pdfBuffer: Buffer, filename: string): Promise<{ ok: boolean; status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const boundary = '----SuryaBoundary' + Date.now().toString(16);
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, pdfBuffer, footer]);

    const url = new URL(`${PDF_SERVER_URL}/extract`);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 30 * 60 * 1000, // 30 minutes
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          ok: (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300,
          status: res.statusCode || 500,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('OCR request timed out after 30 minutes'));
    });

    req.write(body);
    req.end();
  });
}

export async function POST(request: NextRequest) {
  try {
    const { filename } = await request.json();

    if (!filename || typeof filename !== 'string') {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 });
    }

    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
    }

    const pdfPath = join(BOOKS_PATH, filename);
    if (!existsSync(pdfPath)) {
      return NextResponse.json({ error: 'PDF file not found' }, { status: 404 });
    }

    const pdfBuffer = await readFile(pdfPath);
    const ocrResult = await postToSurya(pdfBuffer, filename);

    if (!ocrResult.ok) {
      return NextResponse.json(
        { error: `OCR extraction failed: ${ocrResult.body}` },
        { status: 502 }
      );
    }

    const extractedData = JSON.parse(ocrResult.body);

    // Save extracted text (atomic write)
    const extractsDir = join(BOOKS_PATH, 'pdf-extracts');
    if (!existsSync(extractsDir)) {
      await mkdir(extractsDir, { recursive: true });
    }

    const baseName = filename.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*]/g, '_');
    const extractPath = join(extractsDir, `${baseName}.json`);
    const tmpPath = extractPath + '.tmp';

    await writeFile(tmpPath, JSON.stringify({
      ...extractedData,
      filename,
      extractedAt: new Date().toISOString(),
    }, null, 2));
    await rename(tmpPath, extractPath);

    return NextResponse.json({
      success: true,
      filename,
      pageCount: extractedData.pages?.length || 0,
    });
  } catch (error) {
    console.error('PDF re-extract error:', error);
    return NextResponse.json({ error: 'Failed to re-extract. Is the Surya OCR service running?' }, { status: 500 });
  }
}
