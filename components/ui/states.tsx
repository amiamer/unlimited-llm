/**
 * Shared Loading / Empty / Error state components.
 * Feature: ui-overhaul
 *
 * One token-styled, layout-consistent set of states used by every page, so the
 * app always communicates what it is doing the same way. All three share the
 * same centered-column layout primitives for cross-page visual consistency.
 */

import type { ReactNode } from 'react';

const SHELL =
  'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center';

export interface LoadingStateProps {
  /** Optional message under the spinner. */
  message?: string;
  className?: string;
}

export function LoadingState({ message, className }: LoadingStateProps) {
  return (
    <div className={`${SHELL} ${className ?? ''}`} role="status" aria-live="polite">
      <span
        className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground"
        aria-hidden="true"
      />
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <span className="sr-only">{message ?? 'Loading'}</span>
    </div>
  );
}

export interface EmptyStateProps {
  /** Required descriptive text. */
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Optional call to action. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={`${SHELL} ${className ?? ''}`}>
      {icon && <div className="text-muted-foreground" aria-hidden="true">{icon}</div>}
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  /** Required human-readable message. */
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ message, onRetry, className }: ErrorStateProps) {
  return (
    <div
      className={`${SHELL} rounded-lg border border-destructive/40 bg-destructive/10 ${className ?? ''}`}
      role="alert"
    >
      <p className="max-w-md text-sm text-foreground">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent/50"
        >
          Try again
        </button>
      )}
    </div>
  );
}
