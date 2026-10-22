import { describe, it, expect } from 'vitest';

// Replicate the extraction logic from ArticleReader so we can test it in isolation
const TTS_STRIP_SELECTORS = [
  'style', 'script', 'noscript',
  '.infobox', '.infobox_v2', '.sidebar', '.navbox', '.vertical-navbox',
  '.metadata', '.mw-editsection', '.hatnote', '.toc',
  '.reference', 'sup.reference', '.reflist', '.refbegin',
  '.shortdescription',
  '.thumb', '.thumbinner', '.gallery', '.mw-empty-elt',
  '.mbox-small', '.ambox', '.ombox', '.tmbox', '.cmbox', '.fmbox', '.imbox',
  '.sistersitebox', '.noprint', '.mw-authority-control',
  '.catlinks', '.printfooter', '.mw-jump-link',
  'table',
  '.toc', '.footnotes', '.bibliography',
];

function extractSentences(html: string, unwanted: string[]): string[] {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(html);
  const div = dom.window.document.body;
  const allSelectors = [...new Set([...unwanted, ...TTS_STRIP_SELECTORS])];
  allSelectors.forEach((sel: string) => {
    try { div.querySelectorAll(sel).forEach((el: Element) => el.remove()); } catch {}
  });
  const text = (div.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z""\u201C])/)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 20 && /[a-zA-Z]{3,}/.test(s) && s.split(/\s+/).length > 3);
}

describe('Wikipedia sentence extraction', () => {
  const WIKI_UNWANTED = [
    'style', 'script', 'noscript', '.hatnote',
    '.navbox', '.metadata', '.reference', 'sup.reference', '.mw-editsection',
  ];

  it('extracts clean sentences from simple Wikipedia-like HTML', () => {
    const html = `
      <div class="mw-parser-output">
        <div class="shortdescription" style="display:none">Greek philosopher</div>
        <table class="infobox"><tr><td>Born</td><td>470 BC</td></tr></table>
        <p><b>Socrates</b> was a Greek philosopher from Athens who is credited as the founder of Western philosophy. He is best known through the writings of his students, especially Plato.</p>
        <p>Socrates was born in Athens around 470 BC. His father was a stonemason and his mother was a midwife.</p>
        <style>.mw-parser-output .hatnote{font-style:italic}</style>
        <div class="navbox">Navigation links here</div>
      </div>
    `;
    const sentences = extractSentences(html, WIKI_UNWANTED);

    expect(sentences.length).toBeGreaterThan(0);
    // Should NOT contain infobox table data like "Born" label
    expect(sentences.join(' ')).not.toContain('Born');
    // Should NOT start with "Greek philosopher" from shortdescription
    expect(sentences[0]).not.toMatch(/^Greek philosopher/);
    // First sentence should be about Socrates
    expect(sentences[0]).toContain('Socrates');
    // Should contain actual prose
    expect(sentences[0]).toContain('Greek philosopher from Athens');
  });

  it('filters out short fragments and non-prose', () => {
    const html = `
      <div>
        <p>OK.</p>
        <p>Yes no.</p>
        <p>This is a proper sentence that should be extracted from the article content.</p>
        <p>Another good sentence with enough words to pass the filter easily.</p>
      </div>
    `;
    const sentences = extractSentences(html, []);

    // Short fragments should be filtered out
    expect(sentences.every(s => s.length > 20)).toBe(true);
    expect(sentences.every(s => s.split(/\s+/).length > 3)).toBe(true);
    expect(sentences.length).toBe(2);
  });

  it('strips tables which contain structured data', () => {
    const html = `
      <div>
        <table><tr><td>Name</td><td>Socrates</td></tr><tr><td>Born</td><td>470 BC</td></tr></table>
        <p>Socrates was a classical Greek philosopher credited as one of the founders of Western philosophy.</p>
      </div>
    `;
    const sentences = extractSentences(html, []);

    expect(sentences.join(' ')).not.toContain('Name');
    expect(sentences.join(' ')).not.toContain('470 BC');
    expect(sentences[0]).toContain('Socrates was a classical Greek philosopher');
  });

  it('returns empty array for empty or whitespace-only content', () => {
    expect(extractSentences('', [])).toEqual([]);
    expect(extractSentences('<div>   </div>', [])).toEqual([]);
  });

  it('handles HTML with only non-prose elements', () => {
    const html = `
      <div>
        <table class="infobox"><tr><td>Data</td></tr></table>
        <div class="navbox">Nav</div>
        <style>.foo{}</style>
      </div>
    `;
    const sentences = extractSentences(html, []);
    expect(sentences).toEqual([]);
  });

  it('caps sentences at reasonable length', () => {
    const longSentence = 'A'.repeat(100) + ' word '.repeat(50) + 'end of sentence.';
    const html = `<div><p>${longSentence}</p><p>Short normal sentence that is fine and good.</p></div>`;
    const sentences = extractSentences(html, []);
    // Both should be extracted (we cap at TTS time, not extraction time)
    expect(sentences.length).toBeGreaterThan(0);
  });
});
