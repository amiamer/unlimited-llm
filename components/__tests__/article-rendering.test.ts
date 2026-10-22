/**
 * Static rendering-quality guard for the article readers.
 * Feature: reader-workspace
 * Requirements: 9.1, 9.2, 9.3
 *
 * CSS layout can't be meaningfully asserted in jsdom (no layout engine), so this
 * is a static check in the spirit of the design's testing strategy: the article
 * style blocks must NOT use the banned `zoom` CSS property and MUST provide
 * formatting distinct from body paragraphs for headings, lists, and blockquotes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readComponent(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('article rendering quality (static)', () => {
  const files = [
    'components/WikipediaReader.tsx',
    'components/SEPReader.tsx',
    'components/ArticleReader.tsx',
  ];

  for (const file of files) {
    describe(file, () => {
      const src = readComponent(file);

      it('does not use the banned `zoom` CSS property', () => {
        // Match a CSS `zoom:` declaration specifically (not Tailwind zoom-in-* classes).
        expect(/\bzoom\s*:/.test(src)).toBe(false);
      });
    });
  }

  it('Wikipedia styles format headings, lists, and blockquotes distinctly from body', () => {
    const src = readComponent('components/WikipediaReader.tsx');
    // Headings get their own size/border treatment.
    expect(src).toMatch(/\.wikipedia-content h2\s*\{[^}]*font-size/);
    // Lists are indented.
    expect(src).toMatch(/\.wikipedia-content (ul|ol)[^{]*\{[^}]*margin/);
    // Blockquotes get a distinct left border.
    expect(src).toMatch(/\.wikipedia-content blockquote\s*\{[^}]*border-left/);
  });
});
