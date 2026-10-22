/**
 * Design-system scales — the single source of truth for layout, spacing, and
 * typography class strings.
 * Feature: ui-overhaul
 *
 * Every page and shared component composes these constants instead of
 * re-typing Tailwind utilities, so the app reads as one cohesive product and a
 * spacing/typography change happens in exactly one place. All colors flow
 * through the navy-red semantic Design Tokens (`bg-card`, `text-foreground`,
 * `border-border`, …) — never raw palette steps (`navy-red-*`, `gray-*`).
 */

// ── Container ───────────────────────────────────────────────────────────────
/** Shared maximum content width for `contained` pages. */
export const CONTAINER_MAX_WIDTH = 'max-w-screen-xl';

// ── Spacing Scale ───────────────────────────────────────────────────────────
/** Outer page padding (responsive). */
export const PAGE_PADDING = 'px-4 py-6 md:px-8 md:py-8';
/** Vertical gap between stacked page sections. */
export const SECTION_GAP = 'space-y-6';
/** Padding inside a Surface (use `SURFACE_PADDING_COMPACT` for dense panels). */
export const SURFACE_PADDING = 'p-6';
/** Tighter Surface padding for compact widgets. */
export const SURFACE_PADDING_COMPACT = 'p-4';

// ── Typography Scale ────────────────────────────────────────────────────────
/** Primary page title. */
export const TEXT_PAGE_TITLE = 'text-2xl font-bold text-foreground';
/** Section heading. */
export const TEXT_SECTION_HEADING = 'text-lg font-semibold text-foreground';
/** Body copy. */
export const TEXT_BODY = 'text-sm text-foreground';
/** Secondary / caption text. */
export const TEXT_CAPTION = 'text-xs text-muted-foreground';

// ── Surface ─────────────────────────────────────────────────────────────────
/** A visually lifted container (card/panel/modal). Radius from `--radius`. */
export const SURFACE = 'bg-card border border-border rounded-lg';
