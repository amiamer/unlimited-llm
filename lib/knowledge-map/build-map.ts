/**
 * Knowledge Map — pure graph builder.
 * Feature: knowledge-map
 *
 * Turns the reading data (saved articles + their link-annotations) into the
 * constellation/territory graph, then folds in the reader's persisted hand-edits
 * (positions, manual/hidden edges, assigned years, read flags).
 *
 * Pure and DOM-free: given the same inputs it returns the same graph, so it is
 * unit-tested directly.
 */

import type { Annotation } from '../reader-workspace/types';
import type {
  KnowledgeMap,
  MapArticle,
  MapArticleEdge,
  MapConcept,
  MapLayout,
} from './types';

/** An article plus the annotations captured inside it. */
export interface ArticleInput {
  id: string;
  title: string;
  type: string;
  url?: string;
  annotations: Annotation[];
}

/** Normalize a title/term so links resolve regardless of case/spacing/underscores. */
export function normalizeKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim();
}

/**
 * The concept term an annotation captures, or null if it isn't a link.
 * Mirrors the wikilink rules in book-note.ts (link button + old-style "link"
 * comments), but returns the *bare term* (no [[ ]], no alias).
 */
export function conceptTerm(a: Annotation): string | null {
  const selected = (a.selectedText ?? '').trim();
  // New-style: the Link button sets linkTarget (possibly empty string).
  if (a.linkTarget !== undefined) {
    const t = a.linkTarget.trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();
    return t || selected || null;
  }
  // Old-style: encoded in the comment text.
  const c = (a.comment ?? '').trim();
  if (/^link$/i.test(c)) return selected || null;
  const colon = c.match(/^link:\s*(.+)$/i);
  if (colon) {
    const term = colon[1].trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();
    return term || selected || null;
  }
  const wiki = c.match(/\[\[([^\]]+)\]\]/);
  if (wiki) return wiki[1].split('|')[0].trim() || null;
  return null;
}

const FRESH_LAYOUT: MapLayout = { territories: {}, read: {}, starPositions: {} };

/**
 * Build the knowledge map from the reading data and persisted hand-edits.
 *
 * - Articles become stars; their captured link-annotations become concepts.
 * - A concept whose key matches another article's key adds a constellation edge.
 * - Captured concepts within an article are chained in reading order so a fresh
 *   territory already has a through-line; the reader can re-wire it freely.
 * - Hidden edges are removed, manual edges and assigned years are merged in,
 *   and read flags come only from the persisted map (never inferred).
 */
export function buildKnowledgeMap(
  inputs: ArticleInput[],
  layout: MapLayout = FRESH_LAYOUT,
): KnowledgeMap {
  const articleKeys = new Map<string, string>(); // key → articleId
  inputs.forEach((inp) => articleKeys.set(normalizeKey(inp.title), inp.id));

  const articles: MapArticle[] = [];

  for (const inp of inputs) {
    const concepts: MapConcept[] = [];
    const seenConcept = new Set<string>();
    const terr = layout.territories[inp.id];

    // ── concepts (deduped by normalized term within this article) ──────────
    for (const a of inp.annotations) {
      const term = conceptTerm(a);
      if (!term) continue;
      const key = normalizeKey(term);
      if (!key || seenConcept.has(key)) continue;
      seenConcept.add(key);
      const id = `c_${a.id}`;
      concepts.push({
        id,
        label: term,
        key,
        createdAt: a.createdAt,
        selectedText: (a.selectedText ?? '').trim(),
        year: terr?.years?.[id],
      });
    }

    // ── concept edges: reading-order chain, minus hidden, plus manual ──────
    const hidden = new Set((terr?.hiddenEdges ?? []).map(([x, y]) => edgeId(x, y)));
    const conceptEdges: [string, string][] = [];
    const pushEdge = (x: string, y: string) => {
      if (x === y || hidden.has(edgeId(x, y))) return;
      if (conceptEdges.some(([a, b]) => edgeId(a, b) === edgeId(x, y))) return;
      conceptEdges.push([x, y]);
    };
    for (let i = 0; i < concepts.length - 1; i++) {
      pushEdge(concepts[i].id, concepts[i + 1].id);
    }
    const conceptIds = new Set(concepts.map((c) => c.id));
    for (const [x, y] of terr?.manualEdges ?? []) {
      if (conceptIds.has(x) && conceptIds.has(y)) pushEdge(x, y);
    }

    articles.push({
      id: inp.id,
      key: normalizeKey(inp.title),
      label: inp.title,
      type: inp.type,
      url: inp.url,
      concepts,
      conceptEdges,
      read: layout.read[inp.id] ?? false,
    });
  }

  // ── article edges: direct references + shared concepts ────────────────────
  // Two articles connect if one links to the other's title, OR they both
  // captured the same concept. Undirected, weighted by how many concepts they
  // share. Matching is case-insensitive via normalizeKey.
  type EdgeAcc = { from: string; to: string; via: string; keys: Set<string> };
  const pairs = new Map<string, EdgeAcc>();
  const addPair = (a: string, b: string, key: string, label: string) => {
    if (a === b) return;
    const pk = a < b ? `${a}|${b}` : `${b}|${a}`;
    let e = pairs.get(pk);
    if (!e) { e = { from: a, to: b, via: label, keys: new Set() }; pairs.set(pk, e); }
    e.keys.add(key);
  };

  // direct references: a concept whose key is another article's title.
  for (const art of articles) {
    for (const c of art.concepts) {
      const targetId = articleKeys.get(c.key);
      if (targetId) addPair(art.id, targetId, c.key, c.label);
    }
  }

  // shared concepts: the same concept captured in two or more articles.
  const conceptArticles = new Map<string, { ids: Set<string>; label: string }>();
  for (const art of articles) {
    for (const c of art.concepts) {
      const e = conceptArticles.get(c.key) ?? { ids: new Set<string>(), label: c.label };
      e.ids.add(art.id);
      conceptArticles.set(c.key, e);
    }
  }
  for (const [key, { ids, label }] of conceptArticles) {
    if (ids.size < 2) continue;
    const arr = [...ids];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) addPair(arr[i], arr[j], key, label);
    }
  }

  const articleEdges: MapArticleEdge[] = [...pairs.values()].map((e) => ({
    from: e.from, to: e.to, via: e.via, shared: e.keys.size,
  }));

  return { articles, articleEdges };
}

/** Order-independent edge id, so (a,b) and (b,a) are the same edge. */
export function edgeId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
