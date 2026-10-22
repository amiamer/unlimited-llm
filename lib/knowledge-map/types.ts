/**
 * Knowledge Map — shared types.
 * Feature: knowledge-map
 *
 * The map is ONE graph projected at three zoom levels (constellation → focus →
 * territory) with a timeline cross-cut. It is a *view of your reading data*: the
 * articles you've saved are stars, the [[concept]] links you captured while
 * reading are the concepts inside each article's territory, and a concept whose
 * target is itself an article becomes an edge in the constellation.
 *
 * These types are DOM/React-free so the builder and layout store can be unit
 * tested in Node.
 */

/** A concept captured inside an article (a link-annotation → [[concept]]). */
export interface MapConcept {
  /** Stable id, derived from the source annotation id. */
  id: string;
  /** Display label — the link target term (or the selected text). */
  label: string;
  /** The normalized form of `label`, used to match concepts to articles. */
  key: string;
  /** ISO creation time of the underlying annotation (reading chronology). */
  createdAt: string;
  /** Passage the concept was pulled from (context on hover). */
  selectedText: string;
  /**
   * Optional historical year the reader assigned (e.g. 1848). Negative = BCE.
   * Drives the "by year" timeline; absent concepts fall back to reading order.
   */
  year?: number;
}

/** An article in the library — a star in the constellation. */
export interface MapArticle {
  /** docId — matches the reader/article-library id and the annotation docId. */
  id: string;
  /** Normalized id, used to resolve inter-article links. */
  key: string;
  /** Display title. */
  label: string;
  /** wikipedia | sep | epub | pdf. */
  type: string;
  /** Source URL, if any. */
  url?: string;
  /** Concepts captured inside this article (its territory). */
  concepts: MapConcept[];
  /** Intra-territory edges between this article's own concepts. */
  conceptEdges: [string, string][];
  /** Manual read flag (never inferred — the reader toggles it). */
  read: boolean;
}

/** An edge between two articles in the constellation. */
export interface MapArticleEdge {
  from: string;
  to: string;
  /** A representative concept that produced the link (for the tooltip). */
  via: string;
  /** How many concepts the two articles share (edge weight). */
  shared: number;
}

/** The full built graph. */
export interface KnowledgeMap {
  articles: MapArticle[];
  articleEdges: MapArticleEdge[];
}

// ── Persisted hand-edits (layout overrides) ─────────────────────────────────

/** A saved node position inside a territory, in the territory's own coords. */
export interface NodePosition {
  x: number;
  y: number;
}

/**
 * Everything the reader changes by hand, persisted separately from the derived
 * graph so a re-read never clobbers their arrangement. Keyed by article id.
 */
export interface TerritoryLayout {
  /** conceptId → position. */
  positions: Record<string, NodePosition>;
  /** Manually drawn edges between concepts, beyond the captured ones. */
  manualEdges: [string, string][];
  /** Edges the reader removed (captured edges they don't want). */
  hiddenEdges: [string, string][];
  /** conceptId → assigned historical year. */
  years: Record<string, number>;
}

/** Top-level persisted overrides for the whole map. */
export interface MapLayout {
  /** articleId → its territory layout. */
  territories: Record<string, TerritoryLayout>;
  /** articleId → manual read flag. */
  read: Record<string, boolean>;
  /** articleId → constellation star position { x, y } in 0..1 fractions. */
  starPositions: Record<string, NodePosition>;
}
