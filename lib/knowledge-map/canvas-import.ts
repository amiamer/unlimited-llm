/**
 * Knowledge Map — Obsidian Canvas import.
 * Feature: knowledge-map
 *
 * Reads an Obsidian JSONCanvas (the `.canvas` format) and turns it into the
 * shape the timeline/territory views need: nodes carrying their original canvas
 * position (so we can *copy what you have*) plus a parsed historical year (so we
 * can re-place them on a real time axis), the influence edges, and the era
 * header bands. Pure and DOM-free so it can be unit-tested.
 */

// ── Raw Obsidian JSONCanvas shapes (the bits we use) ────────────────────────

export interface RawCanvasNode {
  id: string;
  type: string; // 'text' | 'file' | 'group' | 'link'
  text?: string;
  file?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string; // '1'..'6' (preset) or hex
}

export interface RawCanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
}

export interface RawCanvas {
  nodes?: RawCanvasNode[];
  edges?: RawCanvasEdge[];
}

// ── Imported shapes ─────────────────────────────────────────────────────────

export interface ImportedNode {
  id: string;
  /** Full original text (first line is the title). */
  label: string;
  /** Heading portion — figure + dates, or the event name. */
  title: string;
  /** Remainder — the idea/description. */
  desc: string;
  /** Parsed historical year (negative = BCE), or null if none found. */
  year: number | null;
  /** Obsidian preset colour key ('2'..'6') or 'none'. */
  color: string;
  /** Original canvas position (territory "copy what you have"). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EraBand {
  label: string;
  year: number;
}

export interface ImportedCanvas {
  nodes: ImportedNode[];
  edges: [string, string][];
  eras: EraBand[];
}

/**
 * Parse a historical year out of free node text. Handles parenthetical date
 * spans ("(1724 - 1804)", "(c.460–370 BCE)"), bare leading event years
 * ("1848 revolutions"), century headers, and BCE. Returns the first
 * year mentioned (negative for BCE), or null.
 */
export function parseYear(text: string): number | null {
  if (!text) return null;
  if (/19TH CENTURY/i.test(text)) return 1800;
  if (/20TH CENTURY/i.test(text)) return 1900;
  if (/21ST CENTURY/i.test(text)) return 2000;
  const paren = text.match(/\(([^)]*\d[^)]*)\)/);
  const scope = paren ? paren[1] : text;
  const bce = /bce|b\.c|bc\b/i.test(scope);
  const digits = scope.match(/\d{1,4}/);
  if (!digits) return null;
  return bce ? -parseInt(digits[0], 10) : parseInt(digits[0], 10);
}

/** Split a node's text into a title (heading) and a description (the rest). */
export function splitTitleDesc(text: string): { title: string; desc: string } {
  const t = (text ?? '').replace(/\n/g, ' ').trim();
  const close = t.indexOf(') ');
  if (close > 0) return { title: t.slice(0, close + 1), desc: t.slice(close + 2) };
  const ev = t.match(/^(\d{3,4}(?:[–-]\d{2,4})?)\s+(.+)/);
  if (ev) {
    const rest = ev[2];
    const dot = rest.indexOf('. ');
    return dot > 0
      ? { title: rest.slice(0, dot), desc: rest.slice(dot + 2) }
      : { title: rest.slice(0, 46), desc: rest.slice(46) };
  }
  return { title: t.slice(0, 46), desc: t.slice(46) };
}

const ERA_COLOR = '1';

/** Convert a raw Obsidian canvas into the imported timeline/territory shape. */
export function importCanvas(raw: RawCanvas): ImportedCanvas {
  const rawNodes = raw.nodes ?? [];
  const rawEdges = raw.edges ?? [];

  const nodes: ImportedNode[] = [];
  const eras: EraBand[] = [];
  const kept = new Set<string>();

  for (const n of rawNodes) {
    const text = (n.text ?? '').trim();
    if (!text || n.type !== 'text') continue;
    const year = parseYear(text);
    if (n.color === ERA_COLOR) {
      if (year != null) eras.push({ label: text.replace(/\n/g, ' ').trim(), year });
      continue;
    }
    if (year == null) continue;
    const { title, desc } = splitTitleDesc(text);
    nodes.push({
      id: n.id,
      label: text.replace(/\n/g, ' ').trim(),
      title,
      desc: desc.slice(0, 200),
      year,
      color: n.color ?? 'none',
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
    });
    kept.add(n.id);
  }

  const edges: [string, string][] = [];
  for (const e of rawEdges) {
    if (kept.has(e.fromNode) && kept.has(e.toNode)) edges.push([e.fromNode, e.toNode]);
  }

  eras.sort((a, b) => a.year - b.year);
  return { nodes, edges, eras };
}
