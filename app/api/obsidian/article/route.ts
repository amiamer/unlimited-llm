import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import { sanitizeFilename, truncateFilename, validatePathSecurity } from '@/lib/local-storage/path-utils';

const NEW_VAULT = process.env.IDEAVERSE_VAULT_PATH;

interface AnnotationInput {
  selectedText: string;
  comment: string;
  linkTarget?: string;
  aiReplies?: { content: string; prompt?: string }[];
}

interface RequestBody {
  title: string;
  source?: string;
  /** Article body markdown already rendered with inline [[links]] by the client. */
  articleContent: string;
  date: string;
  annotations: AnnotationInput[];
}

export interface SaveArticleResult {
  articlePath: string;
  articleCreated: boolean;
  linksInjected: number;
}

// ── Classify ─────────────────────────────────────────────────────────────────

function isLinkComment(comment: string): boolean {
  const c = comment.trim();
  return /^link$/i.test(c) || /^link[:\s]/i.test(c) || c.includes('[[');
}

// ── Article note ──────────────────────────────────────────────────────────────

/** Create a brand-new note: just the article body. No ## my notes section. */
function buildNewNote(articleBody: string): string {
  return `${articleBody}\n`;
}

/**
 * Re-render the article body in an existing note.
 * Everything before ## my notes is replaced with the new body.
 * ## my notes (and anything after it) is preserved ONLY when it has actual user content.
 * Empty ## my notes sections are dropped. Old frontmatter / # Title / ## article /
 * ## reading queue sections from earlier versions are all removed automatically.
 */
function patchArticle(existing: string, newArticleBody: string): string {
  const notesIdx = existing.search(/\n## my notes\b/);
  if (notesIdx === -1) return `${newArticleBody}\n`;

  // Check if there's actual user content after ## my notes
  const afterHeader = existing.slice(notesIdx + '\n## my notes'.length).trimStart();
  // afterHeader is the remaining content; if it's empty or just newlines, drop the section
  if (!afterHeader.trim()) return `${newArticleBody}\n`;

  // User has written something — preserve the whole section
  const notesSuffix = existing.slice(notesIdx + 1); // "## my notes\n..."
  return `${newArticleBody}\n\n${notesSuffix}`;
}

// ── Summary wipe guard ─────────────────────────────────────────────────────

/**
 * The `## Summary` section is app-owned: the client leads `articleContent` with
 * it only when a summary is loaded. If the summary is falsy at save time (not
 * loaded yet, or transiently cleared), the payload is body-only — and since
 * patchArticle replaces everything above `## my notes`, a previously-synced
 * Summary would be silently dropped. This guard mirrors the annotation writer's
 * wipe guard: when the incoming body carries NO Summary but the existing file
 * has one, carry the existing Summary forward rather than erasing it.
 *
 * A legitimately edited Summary still wins, because the client sends it inline
 * (incoming has a `## Summary`) and this guard only fires when incoming has none.
 */
function preserveSummary(existing: string, incoming: string): string {
  const incomingHasSummary = /^##\s+Summary\b/m.test(incoming);
  if (incomingHasSummary) return incoming;

  const m = existing.match(/^##\s+Summary\b[\s\S]*?(?=\n##\s|\n#\s|$)/m);
  if (!m) return incoming; // nothing to preserve
  const existingSummary = m[0].trim();
  return `${existingSummary}\n\n${incoming}`;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!NEW_VAULT) {
    return NextResponse.json({ error: 'IDEAVERSE_VAULT_PATH not configured' }, { status: 503 });
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { title, articleContent, annotations = [] } = body;

  if (!title || !articleContent) {
    return NextResponse.json({ error: 'title and articleContent required' }, { status: 400 });
  }

  try {
    validatePathSecurity(title);
  } catch {
    return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
  }

  const safeTitle = truncateFilename(sanitizeFilename(title));
  const articleFile = path.join(NEW_VAULT, `${safeTitle}.md`);

  // Links are injected into the article body by the client; count them only for
  // the status line the reader shows. Reading annotations themselves are written
  // solely by the Book_Note sync into reading/annotations — this route no longer
  // writes a separate comment file (that was the duplicate writer).
  const isLink = (a: AnnotationInput) => a.linkTarget !== undefined || isLinkComment(a.comment.trim());
  const linksInjected = annotations.filter(isLink).length;

  // ── Article note ─────────────────────────────────────────────────────────
  await fs.mkdir(NEW_VAULT, { recursive: true });
  let articleCreated = false;

  try {
    await fs.access(articleFile);
    // File exists — re-render article body, preserve any real user content after
    // ## my notes AND any previously-synced ## Summary the incoming payload lacks.
    const existing = await fs.readFile(articleFile, 'utf-8');
    await fs.writeFile(articleFile, patchArticle(existing, preserveSummary(existing, articleContent)), 'utf-8');
  } catch {
    // New file
    await fs.writeFile(articleFile, buildNewNote(articleContent), 'utf-8');
    articleCreated = true;
  }

  return NextResponse.json({
    articlePath: articleFile,
    articleCreated,
    linksInjected,
  } satisfies SaveArticleResult);
}
