import { NextRequest, NextResponse } from 'next/server';
import {
  readAnnotationFile,
  writeAnnotationFile,
  listAnnotationFiles,
  isValidDocId,
} from '@/lib/reader-workspace/annotation-files';
import type { Annotation } from '@/lib/reader-workspace/types';

/**
 * Annotation file store API — the durable source of truth for reader
 * annotations (browser storage is a cache of these files).
 *
 * GET  /api/annotations?docId=<id>  → { record: AnnotationFileRecord | null }
 * GET  /api/annotations?index=1     → { index: AnnotationIndexEntry[] }
 * POST /api/annotations             → { ok, skipped? } — body
 *   { docId, annotations, allowEmpty? }. An empty set over a non-empty file is
 *   refused (wipe guard) unless allowEmpty — mirrors the browser-side guards.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('index')) {
    return NextResponse.json({ index: await listAnnotationFiles() });
  }
  const docId = searchParams.get('docId');
  if (!isValidDocId(docId)) {
    return NextResponse.json({ error: 'Invalid docId' }, { status: 400 });
  }
  return NextResponse.json({ record: await readAnnotationFile(docId) });
}

export async function POST(request: NextRequest) {
  let body: { docId?: unknown; annotations?: unknown; allowEmpty?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isValidDocId(body.docId)) {
    return NextResponse.json({ error: 'Invalid docId' }, { status: 400 });
  }
  if (!Array.isArray(body.annotations)) {
    return NextResponse.json({ error: 'annotations must be an array' }, { status: 400 });
  }
  const result = await writeAnnotationFile(body.docId, body.annotations as Annotation[], {
    allowEmpty: body.allowEmpty === true,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result);
}
