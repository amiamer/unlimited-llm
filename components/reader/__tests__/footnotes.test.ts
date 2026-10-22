import { describe, it, expect } from 'vitest';
import * as sbd from 'sbd';
// jsdom ships no types; require-style import matches the other extraction tests
// and keeps `tsc` from erroring on the missing declaration.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom');
import {
  extractParagraphsFromContents,
  collectNotesFromDoc,
  flattenToc,
  titleFromToc,
} from '../EpubDisplay';

/**
 * Validates that EPUB footnote references and note-target anchors survive text
 * extraction so the reader can render clickable links to the back of the book
 * (and back). Markup mirrors a real EPUB's footnote structure.
 */
function docFrom(html: string): Document {
  return new JSDOM(html).window.document as unknown as Document;
}

describe('extractParagraphsFromContents — footnotes', () => {
  it('captures a footnote reference marker and its target note key', () => {
    const doc = docFrom(
      `<html><body>
        <p>Some text before the marker.<a href="../Text/split_040.html#filepos5362969" id="filepos61237"><sup>[1]</sup></a> More text after the marker in the same sentence continues here.</p>
      </body></html>`,
    );
    const paragraphs = extractParagraphsFromContents(doc, sbd);

    expect(paragraphs.length).toBe(1);
    const p = paragraphs[0];
    expect(p.footnotes).toBeDefined();
    const refs = Object.values(p.footnotes!).flat();
    expect(refs.length).toBe(1);
    expect(refs[0].label).toBe('[1]');
    expect(refs[0].noteKey).toBe('filepos5362969');
    expect(refs[0].refId).toBe('filepos61237');
    // Target key fully qualifies the note's file + fragment (notes can live in
    // a different file than the reference).
    expect(refs[0].targetKey).toBe('split_040.html#filepos5362969');
    expect(p.anchors?.['filepos61237']).toBeGreaterThanOrEqual(0);
  });

  it('resolves an EPUB 3 semantic noteref even without a bracketed marker', () => {
    const doc = docFrom(
      `<html><body>
        <p>A claim in the text<a epub:type="noteref" href="notes.xhtml#n1" id="ref1">1</a> follows here.</p>
      </body></html>`,
    );
    const paragraphs = extractParagraphsFromContents(doc, sbd, 'chapter1.xhtml');
    const refs = Object.values(paragraphs[0].footnotes!).flat();
    expect(refs.length).toBe(1);
    expect(refs[0].noteKey).toBe('n1');
    expect(refs[0].targetKey).toBe('notes.xhtml#n1');
  });

  it('captures a note-target anchor (back of the book) with its back-link', () => {
    const doc = docFrom(
      `<html><body>
        <p><a href="../Text/split_006.html#filepos61237" id="filepos5362969"><sup>[1]</sup></a> Translator's note: the original phrase is in French.</p>
      </body></html>`,
    );
    const paragraphs = extractParagraphsFromContents(doc, sbd, 'split_040.html');

    const p = paragraphs[0];
    // The note anchor id is a return target for the reference jump.
    expect(p.anchors?.['filepos5362969']).toBe(0);
    // The note's own "[1]" links back to the reference — a footnote ref itself.
    const refs = Object.values(p.footnotes!).flat();
    expect(refs[0].noteKey).toBe('filepos61237');
  });

  it('maps a marker in a later sentence to the correct sentence index', () => {
    const doc = docFrom(
      `<html><body>
        <p>First sentence has no marker. Second sentence ends with a note.<a href="x.html#n2" id="r2"><sup>[2]</sup></a></p>
      </body></html>`,
    );
    const paragraphs = extractParagraphsFromContents(doc, sbd);
    const p = paragraphs[0];
    expect(p.footnotes?.[1]).toBeDefined();
    expect(p.footnotes?.[0]).toBeUndefined();
    expect(p.footnotes![1][0].noteKey).toBe('n2');
  });

  it('strips the marker text from the prose (rendered as a pill, not inline)', () => {
    const doc = docFrom(
      `<html><body>
        <p>The French line here.<a href="notes.html#n1" id="r1"><sup>[1]</sup></a> The next sentence continues.</p>
      </body></html>`,
    );
    const paragraphs = extractParagraphsFromContents(doc, sbd, 'ch.html');
    const joined = paragraphs[0].sentences.join(' ');
    // The "[1]" must NOT appear in the sentence text — it becomes a pill.
    expect(joined.includes('[1]')).toBe(false);
    // But the reference is still captured for rendering.
    const refs = Object.values(paragraphs[0].footnotes!).flat();
    expect(refs[0].label).toBe('[1]');
  });

  it('ignores links that are not footnote markers', () => {
    const doc = docFrom(
      `<html><body>
        <p>See <a href="chapter2.html#start">the next chapter</a> for details.</p>
      </body></html>`,
    );
    const paragraphs = extractParagraphsFromContents(doc, sbd);
    const p = paragraphs[0];
    expect(p.footnotes).toBeUndefined();
  });
});

describe('collectNotesFromDoc — inline note bodies', () => {
  function docFrom(html: string): Document {
    return new JSDOM(html).window.document as unknown as Document;
  }

  it('collects a legacy calibre-style note keyed by file#id, stripping the marker', () => {
    const doc = docFrom(
      `<html><body>
        <p class="note"><a href="../Text/ch1.html#ref1" id="n1">[1]</a> Translator's note: the original phrase is in French.</p>
      </body></html>`,
    );
    const notes = collectNotesFromDoc(doc, 'notes.html');
    expect(notes['notes.html#n1']).toBeDefined();
    // Leading "[1]" marker is stripped from the body.
    expect(notes['notes.html#n1'].startsWith("Translator's note")).toBe(true);
  });

  it('collects an EPUB 3 <aside epub:type="footnote"> note', () => {
    const doc = docFrom(
      `<html><body>
        <p>Body text.</p>
        <aside epub:type="footnote" id="fn2">2. The English translation of the French line.</aside>
      </body></html>`,
    );
    const notes = collectNotesFromDoc(doc, 'chapter1.xhtml');
    expect(notes['chapter1.xhtml#fn2']).toBe('The English translation of the French line.');
  });

  it('does not treat a whole chapter container as a note', () => {
    const doc = docFrom(
      `<html><body>
        <div id="chap"><p>Para one.</p><p>Para two.</p></div>
      </body></html>`,
    );
    const notes = collectNotesFromDoc(doc, 'c.html');
    expect(notes['c.html#chap']).toBeUndefined();
  });
});

describe('TOC title resolution', () => {
  it('prefers the no-fragment section title over sub-chapter fragments', () => {
    // Mirrors the long novel: "Part One" (whole file) plus "I", "II" (fragments).
    const toc = [
      { label: 'Part One', href: 'Text/War_and_Peace_split_006.html', subitems: [
        { label: 'I', href: 'Text/War_and_Peace_split_006.html#filepos60796' },
        { label: 'II', href: 'Text/War_and_Peace_split_006.html#filepos87520' },
      ] },
    ];
    const flat = flattenToc(toc);
    expect(titleFromToc(flat, 'Text/War_and_Peace_split_006.html')).toBe('Part One');
  });

  it('falls back to the first fragment title when the file only has sub-chapters', () => {
    const toc = [
      { label: 'XIII', href: 'Text/War_and_Peace_split_007.html#filepos1' },
      { label: 'XIV', href: 'Text/War_and_Peace_split_007.html#filepos2' },
    ];
    const flat = flattenToc(toc);
    expect(titleFromToc(flat, 'War_and_Peace_split_007.html')).toBe('XIII');
  });

  it('returns null when the file is not in the TOC', () => {
    const flat = flattenToc([{ label: 'Intro', href: 'intro.html' }]);
    expect(titleFromToc(flat, 'chapter99.html')).toBeNull();
  });
});
