/**
 * @vitest-environment jsdom
 *
 * Tests for the native-HTML sentence annotator.
 * Feature: unified-reader (native article view)
 */

import { describe, it, expect } from 'vitest';
import { annotateArticleHtml } from '../annotate-html';

describe('annotateArticleHtml', () => {
  it('wraps each sentence in a data-sentence-index span, in order', () => {
    const { html, sentences } = annotateArticleHtml(
      '<h2>Origins</h2><p>First sentence. Second one here.</p>',
    );
    expect(sentences).toEqual(['Origins', 'First sentence.', 'Second one here.']);
    expect(html).toContain('data-sentence-index="0"');
    expect(html).toContain('data-sentence-index="1"');
    expect(html).toContain('data-sentence-index="2"');
  });

  it('preserves the heading element (native structure)', () => {
    const { html } = annotateArticleHtml('<h2>Etymology</h2><p>A word.</p>');
    expect(html).toContain('<h2>');
    expect(html).toContain('</h2>');
  });

  it('keeps inline links inside their sentence rather than flattening them', () => {
    const { html, sentences } = annotateArticleHtml(
      '<p>See the <a href="/x">linked page</a> for more.</p>',
    );
    expect(html).toContain('<a href="/x">linked page</a>');
    expect(sentences).toEqual(['See the linked page for more.']);
  });

  it('strips boilerplate (tables, references) before wrapping', () => {
    const { sentences } = annotateArticleHtml(
      '<p>Keep this.</p><table><tr><td>drop me</td></tr></table><sup class="reference">[1]</sup>',
    );
    expect(sentences).toEqual(['Keep this.']);
  });

  it('handles a heading/list with no terminal punctuation as one sentence each', () => {
    const { sentences } = annotateArticleHtml(
      '<h3>Background</h3><ul><li>Alpha</li><li>Beta point.</li></ul>',
    );
    expect(sentences).toEqual(['Background', 'Alpha', 'Beta point.']);
  });

  it('produces no spans for empty input', () => {
    const { sentences } = annotateArticleHtml('');
    expect(sentences).toEqual([]);
  });

  it('keeps the sentences array and DOM anchors in sync (same count)', () => {
    const { html, sentences } = annotateArticleHtml(
      '<p>One. Two. Three.</p><p>Four here. Five there.</p>',
    );
    const anchorCount = (html.match(/data-sentence-index="/g) || []).length;
    expect(anchorCount).toBe(sentences.length);
    expect(sentences.length).toBe(5);
  });
});
