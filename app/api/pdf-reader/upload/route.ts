import { NextRequest } from 'next/server';
import { writeFile, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import http from 'http';

/**
 * PDF Upload + Surya OCR Extraction — SSE streaming response
 * POST /api/pdf-reader/upload
 *
 * Streams progress events so the client can show a live extraction bar:
 *   { stage: 'saving' | 'saved' | 'warn' | 'done' | 'error', message, filename?, pageCount? }
 */

const BOOKS_PATH = process.env.BOOKS_PATH || './books';
const PDF_SERVER_URL = process.env.PDF_SERVER_URL || 'http://localhost:8100';

export const maxDuration = 1800;

function postToSurya(
  pdfBuffer: Buffer,
  filename: string,
): Promise<{ ok: boolean; body: string }> {
  return new Promise((resolve, reject) => {
    const boundary = '----SuryaBoundary' + Date.now().toString(16);
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
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
      timeout: 30 * 60 * 1000,
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          ok: (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300,
          body: Buffer.concat(chunks).toString('utf-8'),
        }),
      );
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('OCR timed out after 30 minutes')));
    req.write(body);
    req.end();
  });
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  // Read the entire request body before starting the stream (request must
  // be consumed while the connection is open, not after returning).
  let buffer: Buffer;
  let fileName: string;
  let filePath: string;
  let extractPath: string;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) return new Response('No file', { status: 400 });
    if (!file.name.toLowerCase().endsWith('.pdf'))
      return new Response('Only .pdf files supported', { status: 400 });
    if (file.size > 100 * 1024 * 1024)
      return new Response('File too large (max 100 MB)', { status: 400 });

    buffer = Buffer.from(await file.arrayBuffer());

    const bookTitle = file.name.replace(/\.pdf$/i, '');
    const sanitized = bookTitle.replace(/[<>:"/\\|?*]/g, '_');
    fileName = `${sanitized}.pdf`;

    if (!existsSync(BOOKS_PATH)) await mkdir(BOOKS_PATH, { recursive: true });
    const extractsDir = join(BOOKS_PATH, 'pdf-extracts');
    if (!existsSync(extractsDir)) await mkdir(extractsDir, { recursive: true });

    filePath = join(BOOKS_PATH, fileName);
    extractPath = join(extractsDir, `${sanitized}.json`);
  } catch {
    return new Response('Invalid request', { status: 400 });
  }

  // SSE stream — processing runs asynchronously after the Response is returned.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  const emit = (data: Record<string, unknown>) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  void (async () => {
    try {
      await emit({ stage: 'saving', message: 'Saving PDF to disk…' });

      const tmp = filePath + '.tmp';
      await writeFile(tmp, buffer);
      await rename(tmp, filePath);

      await emit({
        stage: 'saved',
        message: 'PDF saved. Starting OCR extraction — this can take a few minutes for large files…',
        filename: fileName,
      });

      try {
        const ocr = await postToSurya(buffer, fileName);

        if (!ocr.ok) {
          await emit({
            stage: 'warn',
            message: `PDF saved, but OCR failed: ${ocr.body.slice(0, 120)}. Is the Surya service running?`,
            filename: fileName,
          });
          return;
        }

        const extracted = JSON.parse(ocr.body) as { pages?: unknown[] };

        const extractTmp = extractPath + '.tmp';
        await writeFile(
          extractTmp,
          JSON.stringify({ ...extracted, filename: fileName, extractedAt: new Date().toISOString() }, null, 2),
        );
        await rename(extractTmp, extractPath);

        await emit({
          stage: 'done',
          message: `Done — ${extracted.pages?.length ?? 0} pages extracted`,
          filename: fileName,
          pageCount: extracted.pages?.length ?? 0,
        });
      } catch {
        await emit({
          stage: 'warn',
          message: 'PDF saved — Surya OCR service is not running. Start it and re-extract from the PDF reader.',
          filename: fileName,
        });
      }
    } catch (err) {
      await emit({
        stage: 'error',
        message: err instanceof Error ? err.message : 'Upload failed',
      });
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
