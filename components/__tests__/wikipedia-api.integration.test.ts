import { describe, it, expect } from 'vitest';

describe('Wikipedia API response', () => {
  it('returns HTML content for a known article', async () => {
    const searchUrl = 'https://en.wikipedia.org/w/api.php?action=parse&page=Socrates&format=json&origin=*&prop=text';
    const res = await fetch(searchUrl);
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.parse).toBeDefined();
    expect(data.parse.title).toBe('Socrates');

    const html = data.parse.text['*'];
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(1000);

    // Should contain the mw-parser-output wrapper
    expect(html).toContain('mw-parser-output');
    // Should contain actual prose about Socrates
    expect(html).toContain('philosopher');
  });

  it('extracts clean sentences from real Wikipedia HTML', async () => {
    const res = await fetch('https://en.wikipedia.org/w/api.php?action=parse&page=Socrates&format=json&origin=*&prop=text');
    const data = await res.json();
    const html = data.parse.text['*'];

    // Use the same extraction logic
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(html);
    const div = dom.window.document.body;

    const stripSelectors = [
      'style', 'script', 'noscript',
      '.infobox', '.infobox_v2', '.sidebar', '.navbox', '.vertical-navbox',
      '.metadata', '.mw-editsection', '.hatnote', '.toc', '.shortdescription',
      '.reference', 'sup.reference', '.reflist', '.refbegin',
      '.thumb', '.thumbinner', '.gallery', '.mw-empty-elt',
      '.mbox-small', '.ambox', '.ombox', '.tmbox', '.cmbox', '.fmbox', '.imbox',
      '.sistersitebox', '.noprint', '.mw-authority-control',
      '.catlinks', '.printfooter', '.mw-jump-link',
      'table', '.footnotes', '.bibliography',
    ];

    stripSelectors.forEach(sel => {
      try { div.querySelectorAll(sel).forEach((el: Element) => el.remove()); } catch {}
    });

    const text = (div.textContent || '').replace(/\s+/g, ' ').trim();
    expect(text.length).toBeGreaterThan(500);

    const sentences = text
      .split(/(?<=[.!?])\s+(?=[A-Z""\u201C])/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 20 && /[a-zA-Z]{3,}/.test(s) && s.split(/\s+/).length > 3);

    expect(sentences.length).toBeGreaterThan(10);

    // First sentence should be real prose, not metadata
    expect(sentences[0]).toContain('Socrates');
    expect(sentences[0].length).toBeLessThan(1000);

    // No sentence should be just numbers or table data
    sentences.slice(0, 20).forEach((s: string) => {
      expect(s.split(/\s+/).length).toBeGreaterThan(3);
    });

    console.log(`Extracted ${sentences.length} sentences`);
    console.log('First 3:', sentences.slice(0, 3));
  }, 15000);
});
