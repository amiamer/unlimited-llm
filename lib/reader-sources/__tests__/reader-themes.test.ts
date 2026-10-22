import { describe, expect, it } from 'vitest';
import { READER_THEMES, readerThemeVars } from '../reader-themes';

// WCAG relative luminance / contrast ratio for #RRGGBB colors.
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('reader theme highlights', () => {
  it.each(READER_THEMES.map((t) => [t.id, t] as const))('%s keeps text readable on every highlight', (_id, theme) => {
    const { text, bg, link, note, noteActive, linkHighlight, linkHighlightActive } = theme.vars;
    for (const highlight of [note, noteActive, linkHighlight, linkHighlightActive]) {
      expect(contrast(text, highlight)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(link, highlight)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(link, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('exposes the highlight colors as CSS variables', () => {
    const vars = readerThemeVars(READER_THEMES[0]);
    for (const name of ['--reader-link', '--reader-hl-note', '--reader-hl-note-active', '--reader-hl-link', '--reader-hl-link-active']) {
      expect(vars[name]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
