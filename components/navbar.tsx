'use client';

/**
 * Unified top navigation.
 * Feature: ui-overhaul
 *
 * The single Navbar rendered by AppShell on every page. Maps over the
 * NAV_ITEMS source of truth, highlights the active route via isActiveNav, and
 * collapses to a hamburger menu at/below the `md` breakpoint. Tokens only — no
 * Legacy palette classes.
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, isActiveNav } from '@/lib/ui/navigation';
import { CONTAINER_MAX_WIDTH } from '@/lib/ui/design-system';

export interface NavbarProps {
  /** Brand text shown at the left of the navbar. */
  brand?: string;
}

function linkClasses(active: boolean): string {
  return [
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    active
      ? 'bg-accent text-accent-foreground'
      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
  ].join(' ');
}

export default function Navbar({ brand = 'natural stupidity.' }: NavbarProps) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div
        className={`${CONTAINER_MAX_WIDTH} mx-auto flex h-14 items-center justify-between gap-4 px-4 md:px-8`}
      >
        <Link
          href="/"
          className="shrink-0 text-sm font-semibold tracking-tight text-foreground transition-opacity hover:opacity-80"
        >
          {brand}
        </Link>

        {/* Desktop links */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={linkClasses(isActiveNav(pathname, item.href))}
              aria-current={isActiveNav(pathname, item.href) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Mobile toggle */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground md:hidden"
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={open}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {open ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <nav
          className="border-t border-border bg-background px-4 py-2 md:hidden"
          aria-label="Primary mobile"
        >
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`block ${linkClasses(isActiveNav(pathname, item.href))}`}
                  aria-current={
                    isActiveNav(pathname, item.href) ? 'page' : undefined
                  }
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
