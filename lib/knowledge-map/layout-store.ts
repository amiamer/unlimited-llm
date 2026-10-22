/**
 * Knowledge Map — layout persistence.
 * Feature: knowledge-map
 *
 * The reader's hand-edits (node positions, manual/hidden edges, assigned years,
 * read flags, star positions) live here, separate from the derived graph, so a
 * re-read of the underlying reading data never clobbers their arrangement.
 * localStorage-backed and intentionally small.
 */

import type { MapLayout, TerritoryLayout, NodePosition } from './types';

const STORAGE_KEY = 'knowledge-map-layout:v1';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function emptyLayout(): MapLayout {
  return { territories: {}, read: {}, starPositions: {} };
}

function emptyTerritory(): TerritoryLayout {
  return { positions: {}, manualEdges: [], hiddenEdges: [], years: {} };
}

/** Load the saved layout, tolerating older/partial shapes. */
export function loadLayout(): MapLayout {
  if (!hasStorage()) return emptyLayout();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyLayout();
    const p = JSON.parse(raw) as Partial<MapLayout>;
    return {
      territories: p.territories ?? {},
      read: p.read ?? {},
      starPositions: p.starPositions ?? {},
    };
  } catch {
    return emptyLayout();
  }
}

/** Persist the whole layout (best-effort). */
export function saveLayout(layout: MapLayout): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* quota / private mode */
  }
}

// ── Immutable update helpers (return a new layout; caller saves) ────────────

function withTerritory(
  layout: MapLayout,
  articleId: string,
  fn: (t: TerritoryLayout) => TerritoryLayout,
): MapLayout {
  const current = layout.territories[articleId] ?? emptyTerritory();
  return {
    ...layout,
    territories: { ...layout.territories, [articleId]: fn(current) },
  };
}

export function setNodePosition(
  layout: MapLayout,
  articleId: string,
  conceptId: string,
  pos: NodePosition,
): MapLayout {
  return withTerritory(layout, articleId, (t) => ({
    ...t,
    positions: { ...t.positions, [conceptId]: pos },
  }));
}

export function addManualEdge(
  layout: MapLayout,
  articleId: string,
  a: string,
  b: string,
): MapLayout {
  if (a === b) return layout;
  return withTerritory(layout, articleId, (t) => {
    if (t.manualEdges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return t;
    // If this edge was previously hidden, un-hide it instead of duplicating.
    const hiddenEdges = t.hiddenEdges.filter(
      ([x, y]) => !((x === a && y === b) || (x === b && y === a)),
    );
    return { ...t, manualEdges: [...t.manualEdges, [a, b]], hiddenEdges };
  });
}

export function removeEdge(
  layout: MapLayout,
  articleId: string,
  a: string,
  b: string,
): MapLayout {
  return withTerritory(layout, articleId, (t) => {
    const manualEdges = t.manualEdges.filter(
      ([x, y]) => !((x === a && y === b) || (x === b && y === a)),
    );
    const already = t.hiddenEdges.some(
      ([x, y]) => (x === a && y === b) || (x === b && y === a),
    );
    const hiddenEdges = already ? t.hiddenEdges : [...t.hiddenEdges, [a, b] as [string, string]];
    return { ...t, manualEdges, hiddenEdges };
  });
}

export function setConceptYear(
  layout: MapLayout,
  articleId: string,
  conceptId: string,
  year: number | null,
): MapLayout {
  return withTerritory(layout, articleId, (t) => {
    const years = { ...t.years };
    if (year === null || Number.isNaN(year)) delete years[conceptId];
    else years[conceptId] = year;
    return { ...t, years };
  });
}

export function setRead(layout: MapLayout, articleId: string, read: boolean): MapLayout {
  return { ...layout, read: { ...layout.read, [articleId]: read } };
}

export function setStarPosition(
  layout: MapLayout,
  articleId: string,
  pos: NodePosition,
): MapLayout {
  return { ...layout, starPositions: { ...layout.starPositions, [articleId]: pos } };
}
