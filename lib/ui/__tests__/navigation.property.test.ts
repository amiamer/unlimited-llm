/**
 * Property-Based Tests for navigation active-state + label contract.
 * Feature: ui-overhaul
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { NAV_ITEMS, isActiveNav } from '../navigation';

const NON_ROOT = NAV_ITEMS.filter((i) => i.href !== '/').map((i) => i.href);

const REQUIRED_LABELS: Record<string, string> = {
  '/': 'Home',
  '/chat': 'Chat',
  '/reader': 'Reader',
  '/vault': 'Vault',
  '/knowledge-map': 'Map',
  '/reading-list': 'Ranking',
  '/habit-tracker': 'Habit Tracker',
};

/** Arbitrary pathnames: random strings + structured route-shaped traps. */
const pathnameArb = fc.oneof(
  fc.string(),
  fc.constantFrom('', '/', '//'),
  fc.constantFrom(...NON_ROOT),
  // Nested sub-route: href + "/" + segment.
  fc
    .tuple(fc.constantFrom(...NON_ROOT), fc.string({ minLength: 1 }))
    .map(([href, seg]) => `${href}/${seg}`),
  // Prefix-collision trap: href + "-suffix" (must NOT match).
  fc
    .tuple(fc.constantFrom(...NON_ROOT), fc.string({ minLength: 1 }))
    .map(([href, seg]) => `${href}-${seg}`),
);

describe('navigation — property-based', () => {
  /**
   * Feature: ui-overhaul, Property 1: Navigation active-state selection is
   * correct and unambiguous.
   */
  it('Property 1: active-state is correct, total, and at most one item is active', () => {
    fc.assert(
      fc.property(pathnameArb, (pathname) => {
        // Never throws on any string.
        const flags = NAV_ITEMS.map((item) => isActiveNav(pathname, item.href));

        // Root rule.
        expect(isActiveNav(pathname, '/')).toBe(pathname === '/');

        // Equal-or-nested rule for non-root hrefs.
        for (const href of NON_ROOT) {
          const expected = pathname === href || pathname.startsWith(`${href}/`);
          expect(isActiveNav(pathname, href)).toBe(expected);
        }

        // At most one active across the whole set.
        expect(flags.filter(Boolean).length).toBeLessThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
  });

  /** Every in-scope route marks exactly one item active. */
  it('Property 1 (corollary): each in-scope route activates exactly one item', () => {
    for (const item of NAV_ITEMS) {
      const activeCount = NAV_ITEMS.filter((n) =>
        isActiveNav(item.href, n.href),
      ).length;
      expect(activeCount).toBe(1);
    }
  });

  /**
   * Feature: ui-overhaul, Property 2: Route→label normalization contract holds
   * for every in-scope route.
   */
  it('Property 2: every NAV_ITEMS entry maps its href to the required label', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NAV_ITEMS), (item) => {
        expect(item.label).toBe(REQUIRED_LABELS[item.href]);
      }),
      { numRuns: 100 },
    );
    // And no playful Legacy label survives.
    const labels = NAV_ITEMS.map((i) => i.label);
    expect(labels).not.toContain('useles?');
    expect(labels).not.toContain('yapstufu');
    expect(labels).not.toContain('reeding');
    expect(labels).not.toContain('moolah');
  });
});
