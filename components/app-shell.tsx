/**
 * Application shell.
 * Feature: ui-overhaul
 *
 * Wraps a page with the unified Navbar and a consistent layout. Adopted
 * per-page (not in the root layout) so auth pages stay shell-free and each page
 * chooses its layout variant:
 *
 *  - `contained` (default): a centered document column with the shared max
 *    width, page padding, and vertical section rhythm. For Home, Finance,
 *    Transactions, Health.
 *  - `full`: Navbar only, then a flex/height-managed region the page fills
 *    edge-to-edge. For Reader (three-rail), Chat, PDF, Wikipedia, SEP.
 *
 * All layout class strings come from lib/ui/design-system.ts.
 */

import type { ReactNode } from 'react';
import Navbar from './navbar';
import {
  CONTAINER_MAX_WIDTH,
  PAGE_PADDING,
  SECTION_GAP,
} from '@/lib/ui/design-system';

export interface AppShellProps {
  children: ReactNode;
  /** "contained" = centered max-width document; "full" = page owns region below navbar. */
  variant?: 'contained' | 'full';
  /** Optional brand override passed to the Navbar. */
  brand?: string;
}

export default function AppShell({
  children,
  variant = 'contained',
  brand,
}: AppShellProps) {
  if (variant === 'full') {
    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        <Navbar brand={brand} />
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar brand={brand} />
      <main className={`${CONTAINER_MAX_WIDTH} mx-auto ${PAGE_PADDING} ${SECTION_GAP}`}>
        {children}
      </main>
    </div>
  );
}
