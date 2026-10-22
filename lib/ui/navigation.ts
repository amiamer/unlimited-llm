/**
 * Navigation single source of truth.
 * Feature: ui-overhaul
 *
 * One ordered route→label list and one pure active-state selector, shared by
 * the unified Navbar so every page agrees on what the primary destinations are
 * and which one is "active". Keeping this here (not inline in the Navbar) makes
 * the route→label contract and the active-state rule testable in isolation.
 */

export interface NavItem {
  /** Route path, e.g. "/", "/chat". */
  href: string;
  /** Normalized, professional label, e.g. "Home", "Chat". */
  label: string;
}

/** The single ordered list of primary navigation destinations. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/chat', label: 'Chat' },
  { href: '/reader', label: 'Reader' },
  { href: '/vault', label: 'Vault' },
  { href: '/knowledge-map', label: 'Map' },
  { href: '/reading-list', label: 'Ranking' },
  { href: '/habit-tracker', label: 'Habit Tracker' },
] as const;

/**
 * Whether `href` is the active nav item for the current `pathname`.
 *
 * Total and pure — returns a deterministic boolean for any string input and
 * never throws (handles '', '/', trailing slashes, and unknown routes).
 *
 * Rules:
 * - Home ('/') is active iff the pathname is exactly '/'.
 * - Any other item is active iff the pathname equals its href OR is a nested
 *   sub-route of it (`href + '/'` prefix).
 *
 * Because the non-root hrefs are mutually non-prefixing, at most one item is
 * ever active for a given pathname (exactly one for any in-scope route). The
 * explicit `'/'`-segment boundary prevents prefix-collision false positives
 * (e.g. '/sep' must not match '/sep-foo').
 */
export function isActiveNav(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
