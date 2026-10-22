import { NextRequest, NextResponse } from 'next/server';
import {
  isValidArticleId,
  listArticleFiles,
  readArticleFile,
  removeArticleFile,
  writeArticleFile,
} from '@/lib/reader-sources/article-files';

export const dynamic = 'force-dynamic';

const TYPES = new Set(['wikipedia', 'sep', 'iep']);
const MAX_ARTICLE_BYTES = 20 * 1024 * 1024;

/**
 * Saved-article library shared by every browser (see article-files.ts).
 *
 * GET    /api/reader/articles          → { articles, removed } — articles without their
 *                                         text; removed = tombstoned ids
 * GET    /api/reader/articles?id=<id>  → { article } with its text, or 404
 * POST   /api/reader/articles          → { ok, removed? } — body { id, type, title, content, url?, savedAt?, restore? }
 * DELETE /api/reader/articles?id=<id>  → { ok }
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (id !== null) {
    if (!isValidArticleId(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const article = await readArticleFile(id);
    return article
      ? NextResponse.json({ article })
      : NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const files = await listArticleFiles();
  return NextResponse.json({
    articles: files.filter((f) => !f.removed).map((f) => ({ id: f.id, type: f.type, title: f.title, url: f.url, savedAt: f.savedAt })),
    removed: files.filter((f) => f.removed).map((f) => f.id),
  });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { id, type, title, content, url } = body;
  if (!isValidArticleId(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (typeof type !== 'string' || !TYPES.has(type)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  if (typeof title !== 'string' || typeof content !== 'string' || !content) {
    return NextResponse.json({ error: 'title and content required' }, { status: 400 });
  }
  if (Buffer.byteLength(content) > MAX_ARTICLE_BYTES) return NextResponse.json({ error: 'Article is too large.' }, { status: 413 });
  const result = await writeArticleFile(
    {
      id,
      type: type as 'wikipedia' | 'sep' | 'iep',
      title,
      content,
      url: typeof url === 'string' ? url : undefined,
      savedAt: typeof body.savedAt === 'number' ? body.savedAt : Date.now(),
    },
    { restore: body.restore === true },
  );
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!isValidArticleId(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  await removeArticleFile(id);
  return NextResponse.json({ ok: true });
}
