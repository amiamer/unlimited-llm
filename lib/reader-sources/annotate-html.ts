/**
 * Unified reader — native HTML annotator.
 * Feature: unified-reader (native article view)
 *
 * Takes an article's real HTML and wraps each sentence in a
 * `<span data-sentence-index="N">`, WITHOUT flattening the structure — headings,
 * lists, blockquotes, images, and inline links/bold are all preserved. The
 * native view renders this HTML directly (so it looks like the real page) while
 * the injected anchors let read-along highlight and notes attach per sentence.
 *
 * Browser/jsdom only (uses the DOM). Returns the annotated HTML plus the
 * parallel `sentences` array (index N === the Nth wrapped span), which the
 * read-along matcher consumes — keeping the DOM anchors and the matcher in sync.
 */

import { NATIVE_VIEW_STRIP_SELECTORS, stripWikiTemplates } from './extract-article';

export interface AnnotatedArticle {
  /** HTML with sentence spans injected; render via dangerouslySetInnerHTML. */
  html: string;
  /** Sentence text in document order; index === data-sentence-index. */
  sentences: string[];
}

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote';
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function newSpan(doc: Document, index: number): HTMLSpanElement {
  const span = doc.createElement('span');
  span.setAttribute('data-sentence-index', String(index));
  span.className = 'ra-s';
  return span;
}

/**
 * Wrap the sentences of a single leaf block, preserving its inline children.
 * Sentence boundaries are detected only within text nodes (so a link or bold
 * run never splits a sentence). Returns the next free sentence index.
 */
function annotateBlock(block: HTMLElement, start: number, sentences: string[]): number {
  const doc = block.ownerDocument;
  const original = Array.from(block.childNodes);
  block.textContent = '';

  let counter = start;
  let span = newSpan(doc, counter);

  const closeIfContent = (): void => {
    const text = (span.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length > 0) {
      sentences.push(text);
      block.appendChild(span);
      block.appendChild(doc.createTextNode(' '));
      counter++;
      span = newSpan(doc, counter);
    }
  };

  const consumeText = (text: string): void => {
    // Each chunk is a run ending at sentence punctuation, or the trailing run.
    const chunks = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
    if (!chunks) {
      if (text) span.appendChild(doc.createTextNode(text));
      return;
    }
    for (const chunk of chunks) {
      span.appendChild(doc.createTextNode(chunk));
      if (/[.!?]["'”’)]*\s*$/.test(chunk)) closeIfContent();
    }
  };

  for (const node of original) {
    if (node.nodeType === TEXT_NODE) {
      consumeText(node.textContent || '');
    } else if (node.nodeType === ELEMENT_NODE) {
      // Inline element (link, bold, sup, …) stays inside the current sentence.
      span.appendChild(node.cloneNode(true));
    }
  }
  closeIfContent();
  return counter;
}

export function annotateArticleHtml(html: string, unwanted: string[] = []): AnnotatedArticle {
  // Wikipedia (and other wikis) use protocol-relative URLs for images:
  //   src="//upload.wikimedia.org/..."
  // On localhost (HTTP) these resolve to http://, which the app's CSP blocks
  // (img-src only allows https://). Force HTTPS on all URL-bearing attributes.
  const normalizedHtml = stripWikiTemplates(html)
    .replace(/(src|srcset|data-src|data-srcset)="\/\//g, '$1="https://')
    .replace(/(src|srcset|data-src|data-srcset)='\/\//g, "$1='https://");

  const root = document.createElement('div');
  root.innerHTML = normalizedHtml;

  for (const sel of new Set([...unwanted, ...NATIVE_VIEW_STRIP_SELECTORS])) {
    try {
      root.querySelectorAll(sel).forEach((el) => el.remove());
    } catch {
      // invalid selector — skip
    }
  }

  const sentences: string[] = [];
  let counter = 0;

  for (const block of Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))) {
    // Process only leaf-ish blocks so a list item holding a paragraph isn't
    // double-wrapped.
    if (block.querySelector(BLOCK_SELECTOR)) continue;
    counter = annotateBlock(block, counter, sentences);
  }

  return { html: root.innerHTML, sentences };
}
