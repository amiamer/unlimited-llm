/**
 * Shared article → sentences extraction.
 * Feature: unified-reader
 *
 * Lifted out of `components/ArticleReader.tsx` so the unified reader can turn
 * any HTML article source (Wikipedia, SEP, and later others) into the same
 * normalized sentence stream the reader renders — without dragging in the whole
 * ArticleReader component. Browser-only (uses the DOM), like the original.
 */

/** Boilerplate selectors stripped before TTS extraction (nav chrome, refs, tables, images). */
export const TTS_STRIP_SELECTORS = [
  'style', 'script', 'noscript',
  '.infobox', '.infobox_v2', '.sidebar', '.navbox', '.vertical-navbox',
  '.metadata', '.mw-editsection', '.hatnote', '.toc',
  '.reference', 'sup.reference', '.reflist', '.refbegin',
  '.thumb', '.thumbinner', '.gallery', '.mw-empty-elt',
  '.mbox-small', '.ambox', '.ombox', '.tmbox', '.cmbox', '.fmbox', '.imbox',
  '.sistersitebox', '.noprint', '.mw-authority-control',
  '.catlinks', '.printfooter', '.mw-jump-link',
  'table',
  '.toc', '.footnotes', '.bibliography',
];

/**
 * Selectors stripped for the native article view — keeps images/figures/tables
 * so the rendered article looks like the real page. Only nav chrome, scripts,
 * edit UI, citation lists, and accessibility/print elements are removed.
 */
export const NATIVE_VIEW_STRIP_SELECTORS = [
  'style', 'script', 'noscript',
  '.sidebar', '.navbox', '.vertical-navbox',
  '.metadata', '.mw-editsection',
  '.toc',
  'sup.reference', '.reflist', '.refbegin',
  '.mw-empty-elt',
  '.sistersitebox', '.noprint', '.mw-authority-control',
  '.catlinks', '.printfooter', '.mw-jump-link',
  '.footnotes', '.bibliography',
];

/**
 * Strip MediaWiki template markup (`{{ ... }}`) from a string so leftover
 * template syntax never lands in the rendered article or the vault note.
 * Handles nesting (`{{a {{b}} c}}`) by removing innermost braces repeatedly
 * until none remain.
 */
export function stripWikiTemplates(input: string): string {
  let out = input;
  let prev: string;
  do {
    prev = out;
    out = out.replace(/\{\{[^{}]*\}\}/g, '');
  } while (out !== prev && out.includes('{{'));
  return out;
}

/** Normalized text extracted from an HTML source. */
export interface ExtractedText {
  sentences: string[];
  paragraphBreaks: Set<number>;
  headingIndices: Set<number>;
  listItemIndices: Set<number>;
  /** Maps sentence index → HTML heading level (1–6) for heading sentences. */
  headingLevels: Map<number, number>;
}

export function extractArticleSentences(html: string, unwanted: string[]): ExtractedText {
  const div = document.createElement('div');
  div.innerHTML = stripWikiTemplates(html);
  const allSelectors = Array.from(new Set([...unwanted, ...TTS_STRIP_SELECTORS]));
  allSelectors.forEach(sel => {
    try { div.querySelectorAll(sel).forEach(el => el.remove()); } catch {}
  });

  // Extract text per block element for proper paragraph boundaries
  const blocks: { text: string; tag: string }[] = [];
  const blockEls = div.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote');

  if (blockEls.length > 0) {
    const seen = new Set<string>();
    blockEls.forEach(el => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && !seen.has(t)) {
        // Skip parent blocks that contain child blocks (avoid double-counting)
        const childBlocks = el.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote');
        if (childBlocks.length === 0 || /^(LI|BLOCKQUOTE)$/.test(el.tagName)) {
          blocks.push({ text: t, tag: el.tagName.toLowerCase() });
          seen.add(t);
        }
      }
    });
  }

  // Fallback: use full text as one block
  if (blocks.length === 0) {
    const text = (div.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) blocks.push({ text, tag: 'p' });
  }

  // Split each block into sentences
  const sentences: string[] = [];
  const paragraphBreaks = new Set<number>();
  const headingIndices = new Set<number>();
  const listItemIndices = new Set<number>();
  const headingLevels = new Map<number, number>();

  for (const block of blocks) {
    const isHeadingBlock = /^h[1-6]$/.test(block.tag);
    const isListItem = block.tag === 'li';

    if (isHeadingBlock) {
      const level = parseInt(block.tag[1], 10); // 'h2' → 2
      const idx = sentences.length;
      paragraphBreaks.add(idx);
      headingIndices.add(idx);
      headingLevels.set(idx, level);
      sentences.push(block.text);
      continue;
    }

    // Split block into sentences
    const blockSentences = block.text
      .split(/(?<=[.!?])\s+(?=[A-Z""“])/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (blockSentences.length > 0) {
      paragraphBreaks.add(sentences.length);

      for (const sent of blockSentences) {
        const idx = sentences.length;
        if (isListItem) listItemIndices.add(idx);
        sentences.push(sent);
      }
    }
  }

  return { sentences, paragraphBreaks, headingIndices, listItemIndices, headingLevels };
}
