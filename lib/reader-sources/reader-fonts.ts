/**
 * Reader font options.
 * Feature: unified-reader (font picker)
 *
 * All stacks are system-font-first so they work without loading anything
 * extra. The CSS variable --reader-font is applied to the reading column
 * and consumed by TextDisplay and ArticleNativeView.
 */

export interface ReaderFont {
  id: string;
  label: string;
  stack: string;
}

export const READER_FONTS: ReaderFont[] = [
  {
    id: 'georgia',
    label: 'Georgia',
    stack: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  },
  {
    id: 'palatino',
    label: 'Palatino',
    stack: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  },
  {
    id: 'charter',
    label: 'Charter',
    stack: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, serif",
  },
  {
    id: 'sans',
    label: 'Sans',
    stack: "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  },
];

export const DEFAULT_READER_FONT = 'georgia';
export const READER_FONT_STORAGE_KEY = 'reader-font';

export function getReaderFont(id: string | null): ReaderFont {
  return READER_FONTS.find((f) => f.id === id) ?? READER_FONTS[0];
}
