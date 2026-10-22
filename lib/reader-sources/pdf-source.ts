/**
 * Unified reader — PDF source.
 * Feature: unified-reader
 *
 * Lists extracted PDFs (server-side files) for the Library and loads a PDF's
 * extracted text as HTML, so a PDF opens in the same native reader as an
 * article. Text-only for now; the multimodal (image/figure) vision pass is a
 * separate, later project.
 */

export interface PdfLibraryEntry {
  id: string;
  type: 'pdf';
  title: string;
  /** Server filename, used to fetch the extracted text on open. */
  filename: string;
}

interface PdfPage {
  page: number;
  text: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert extracted PDF pages into clean paragraph HTML.
 *
 * Key quality improvements over the naïve version:
 *  - Single newlines (OCR line wraps) are joined to spaces; only blank lines
 *    are treated as paragraph separators.
 *  - Cross-page paragraph continuation: if a page ends without sentence-final
 *    punctuation (or ends with a hyphen), its last block is merged with the
 *    first block of the following page instead of becoming a spurious break.
 *  - De-hyphenation: trailing "-" at a page break is stripped and words joined.
 *  - Heading heuristic: short lines (≤12 words, <120 chars) without trailing
 *    punctuation that start with a capital become `<h2>` elements.
 */
export function pagesToHtml(pages: PdfPage[]): string {
  const validPages = pages.filter((p) => p && typeof p.text === 'string' && p.text.trim());

  // Step 1: flatten all pages into a single sequence of blocks, joining blocks
  // that span a page boundary.
  const blocks: string[] = [];
  let carry = ''; // last block of the previous page, may continue on the next

  for (const page of validPages) {
    // Collapse single newlines (line wraps from OCR) into spaces.
    // Preserve double newlines (actual paragraph separators).
    const normalized = page.text
      .replace(/[ \t]+/g, ' ')
      .replace(/([^\n]) \n([^\n])/g, '$1 $2')   // "word \n word" → "word  word"
      .replace(/([^\n])\n([^\n])/g, '$1 $2');    // "word\nword"   → "word word"

    const rawBlocks = normalized
      .split(/\n{2,}/)
      .map((b) => b.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim())
      .filter(Boolean);

    if (!rawBlocks.length) continue;

    if (carry) {
      const first = rawBlocks[0];
      const lastChar = carry.slice(-1);
      const firstChar = first.charAt(0);

      if (carry.endsWith('-')) {
        // Hyphenation at page break: strip the dash and join.
        rawBlocks[0] = carry.slice(0, -1) + first;
      } else if (!/[.!?'"’”\xBB]$/.test(lastChar) || /^[a-z(–—]/.test(firstChar)) {
        // No sentence-ending punctuation, or next block starts lower-case → continuation.
        rawBlocks[0] = carry + ' ' + first;
      } else {
        blocks.push(carry);
      }
      carry = '';
    }

    blocks.push(...rawBlocks.slice(0, -1));
    carry = rawBlocks[rawBlocks.length - 1];
  }
  if (carry) blocks.push(carry);

  // Step 2: classify each block and emit HTML.
  return blocks
    .filter(Boolean)
    .map((block) => {
      const t = block.trim();
      // Heading heuristic: few words, no trailing sentence punctuation, starts capital.
      const words = t.split(/\s+/);
      const isHeading =
        words.length >= 2 &&
        words.length <= 12 &&
        t.length < 120 &&
        !/[.!?,;:)\]"'']$/.test(t) &&
        /^[A-Z0-9À-Ü]/.test(t);
      return isHeading
        ? `<h2>${escapeHtml(t)}</h2>`
        : `<p>${escapeHtml(t)}</p>`;
    })
    .join('\n');
}

/** List extracted PDFs as Library entries. Returns [] on any failure. */
export async function readPdfLibrary(): Promise<PdfLibraryEntry[]> {
  if (typeof window === 'undefined') return [];
  try {
    const res = await fetch('/api/pdf-reader/books');
    if (!res.ok) return [];
    const data = (await res.json()) as {
      books?: { filename: string; title: string; extracted: boolean }[];
    };
    return (data.books || [])
      .filter((b) => b && b.extracted && b.filename && b.title)
      .map((b) => ({
        id: b.title.replace(/[<>:"/\\|?*]/g, '_'),
        type: 'pdf' as const,
        title: b.title,
        filename: b.filename,
      }));
  } catch {
    return [];
  }
}

/** Delete a PDF and its extract from the server. */
export async function removePdfFromLibrary(filename: string): Promise<void> {
  await fetch(`/api/pdf-reader/books?filename=${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
}

/** Fetch a PDF's extracted text and return it as HTML. Throws if not extracted. */
export async function loadPdfHtml(filename: string): Promise<string> {
  const res = await fetch(`/api/pdf-reader/text/${encodeURIComponent(filename)}`);
  if (!res.ok) throw new Error('This PDF has no extracted text yet.');
  const data = (await res.json()) as { pages?: PdfPage[] };
  return pagesToHtml(data.pages || []);
}
