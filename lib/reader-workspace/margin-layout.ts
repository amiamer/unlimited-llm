/**
 * Reader Workspace — comment margin layout math (pure).
 * Feature: reader-workspace
 *
 * Given each thread's desired top offset (the measured top of its anchored
 * passage) and its height, compute non-overlapping top positions in document
 * order. Each thread sits at its desired offset unless the previous thread
 * would overlap it, in which case it is pushed down by the minimum amount
 * (Requirement 4.2/4.4). Pure and DOM-free so it can be unit tested.
 */

export interface ThreadLayoutInput {
  id: string;
  /** Desired top (e.g. measured passage top within the scroll container). */
  desiredTop: number;
  /** Rendered height of the thread card. */
  height: number;
}

export interface ThreadLayoutResult {
  id: string;
  top: number;
}

/**
 * Lay out threads in input order (callers should pass them sorted by document
 * position, i.e. ascending desiredTop). Returns each thread's resolved top such
 * that no two cards overlap, separated by at least `gap` pixels, and no card is
 * placed above its desired offset.
 */
export function layoutThreads(
  threads: ThreadLayoutInput[],
  gap = 8,
): ThreadLayoutResult[] {
  const result: ThreadLayoutResult[] = [];
  let cursor = -Infinity;

  for (const t of threads) {
    const top = Math.max(t.desiredTop, cursor);
    result.push({ id: t.id, top });
    cursor = top + Math.max(0, t.height) + gap;
  }

  return result;
}
