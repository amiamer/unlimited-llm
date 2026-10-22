/**
 * Reader surface themes.
 * Feature: unified-reader
 *
 * Research-backed reading surfaces (warm-neutral / sepia / desaturated green),
 * with RED locked in as the accent across all of them — the cognition research
 * (Mehta & Zhu 2009) favors red for detail/critical work, and it's the app's
 * identity. The surface colors avoid pure black/white and saturation, per the
 * reading-comfort literature. Each theme is just a set of CSS variables applied
 * to the reading column.
 *
 * Highlights keep one meaning per hue in every view: amber = your notes,
 * violet = linked concepts, the accent = where you're reading (read-along).
 * Each theme carries its own tones, tuned to its surface, so a highlight stays
 * readable (text-on-highlight contrast >= 4.5:1, see the theme tests) instead of
 * one fixed color that only suits dark backgrounds.
 */

export interface ReaderTheme {
  id: string;
  label: string;
  /** Single color shown in the picker swatch. */
  swatch: string;
  /** Whether this is a light surface (affects the swatch ring contrast). */
  light?: boolean;
  vars: {
    bg: string;
    text: string;
    heading: string;
    muted: string;
    accent: string;
    /** Link text in articles. */
    link: string;
    /** Highlight behind a passage you commented on, and the selected one. */
    note: string;
    noteActive: string;
    /** Highlight behind a linked concept, and the selected one. */
    linkHighlight: string;
    linkHighlightActive: string;
  };
}

// Highlight tones per kind of surface (OKLCH-derived; contrast-checked in
// __tests__/reader-themes.test.ts). Dark surfaces get deep, low-chroma tones so
// light text stays crisp; light surfaces get pale highlighter tones.
const DARK_MARKS = {
  link: '#8EBCEC',
  note: '#372C11',
  noteActive: '#57450C',
  linkHighlight: '#2D2A43',
  linkHighlightActive: '#453D6D',
};
const LIGHT_MARKS = {
  link: '#1C5293',
  note: '#F9E7B3',
  noteActive: '#F5D279',
  linkHighlight: '#E7E2FC',
  linkHighlightActive: '#D5CAFD',
};

export const READER_THEMES: ReaderTheme[] = [
  {
    id: 'charcoal',
    label: 'Charcoal',
    swatch: '#17150F',
    vars: { bg: '#17150F', text: '#E4DFD4', heading: '#F2EEE5', muted: '#9A938A', accent: '#C5402F', ...DARK_MARKS },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    swatch: '#141414',
    vars: { bg: '#141414', text: '#E6E6E6', heading: '#FAFAFA', muted: '#9A9A9A', accent: '#C5402F', ...DARK_MARKS },
  },
  {
    id: 'cream',
    label: 'Cream',
    swatch: '#FAF6EE',
    light: true,
    vars: { bg: '#FAF6EE', text: '#26221E', heading: '#18140F', muted: '#7A7168', accent: '#B23A2E', ...LIGHT_MARKS },
  },
  {
    id: 'sepia',
    label: 'Sepia',
    swatch: '#F6F1E7',
    light: true,
    vars: { bg: '#F6F1E7', text: '#2A2521', heading: '#1F1B17', muted: '#6B6258', accent: '#B23A2E', ...LIGHT_MARKS },
  },
  {
    id: 'forest',
    label: 'Forest',
    swatch: '#141C16',
    vars: { bg: '#141C16', text: '#DCE6DD', heading: '#ECF2EC', muted: '#8B9C8D', accent: '#C5402F', ...DARK_MARKS },
  },
  {
    id: 'classic',
    label: 'Classic',
    swatch: '#1a0505',
    vars: {
      bg: '#0a0a0a', text: '#d7d3d0', heading: '#f5f3f2', muted: '#9a938f', accent: '#b83030',
      // A notch deeper than DARK_MARKS for the near-black surface.
      ...DARK_MARKS,
      note: '#302509',
      noteActive: '#4F3D01',
      linkHighlight: '#26223B',
      linkHighlightActive: '#3D3564',
    },
  },
];

export const DEFAULT_READER_THEME = 'charcoal';
export const READER_THEME_STORAGE_KEY = 'reader-theme';

export function getReaderTheme(id: string | null): ReaderTheme {
  return READER_THEMES.find((t) => t.id === id) ?? READER_THEMES[0];
}

/** The CSS variables for a theme, ready to spread into a style prop. */
export function readerThemeVars(theme: ReaderTheme): Record<string, string> {
  return {
    '--reader-bg': theme.vars.bg,
    '--reader-text': theme.vars.text,
    '--reader-heading': theme.vars.heading,
    '--reader-muted': theme.vars.muted,
    '--reader-accent': theme.vars.accent,
    '--reader-link': theme.vars.link,
    '--reader-hl-note': theme.vars.note,
    '--reader-hl-note-active': theme.vars.noteActive,
    '--reader-hl-link': theme.vars.linkHighlight,
    '--reader-hl-link-active': theme.vars.linkHighlightActive,
  };
}
