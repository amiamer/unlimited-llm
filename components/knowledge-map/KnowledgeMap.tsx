'use client';

/**
 * Knowledge Map — the motivational reading constellation.
 * Feature: knowledge-map
 *
 * A single view, on purpose: every saved article is a star. Stars you've marked
 * read glow gold and pulse; articles you've annotated glow amber ("discovered");
 * untouched saves are dim. Edges are the links you made between articles. Click a
 * star to light it up (toggle read). The whole point is motivation — read more,
 * make the sky brighter. Nothing to drill into, nothing to build.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildKnowledgeMap } from '@/lib/knowledge-map/build-map';
import { loadMapInputs } from '@/lib/knowledge-map/load-map-data';
import { loadLayout, saveLayout, setRead } from '@/lib/knowledge-map/layout-store';
import type { KnowledgeMap as KMap, MapArticle, MapLayout } from '@/lib/knowledge-map/types';

type Pos = { x: number; y: number };

/** Deterministic constellation position (0..1 fractions) for article `i` of `n`. */
function defaultStarFrac(i: number, n: number): Pos {
  if (n <= 1) return { x: 0.5, y: 0.5 };
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const col = i % cols;
  const row = Math.floor(i / cols);
  return { x: (col + 1) / (cols + 1), y: (row + 1) / (rows + 1) };
}

/** read = gold+pulse, annotated = amber ("discovered"), else dim. */
function starState(a: MapArticle): 'read' | 'discovered' | 'dim' {
  if (a.read) return 'read';
  if (a.concepts.length > 0) return 'discovered';
  return 'dim';
}

export function KnowledgeMap() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 1200, h: 700 });
  const [loading, setLoading] = useState(true);
  const [map, setMap] = useState<KMap>({ articles: [], articleEdges: [] });
  const [layout, setLayout] = useState<MapLayout>({ territories: {}, read: {}, starPositions: {} });
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = loadLayout();
      const inputs = await loadMapInputs();
      if (!alive) return;
      setLayout(saved);
      setMap(buildKnowledgeMap(inputs, saved));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => setDim({ w: node.clientWidth, h: node.clientHeight }));
    ro.observe(node);
    setDim({ w: node.clientWidth, h: node.clientHeight });
    return () => ro.disconnect();
  }, []);

  const persist = useCallback((next: MapLayout) => { setLayout(next); saveLayout(next); }, []);

  // Click a star to light it up (toggle read).
  const onStarClick = useCallback((id: string) => {
    setMap((m) => {
      const a = m.articles.find((x) => x.id === id);
      if (!a) return m;
      persist(setRead(loadLayout(), id, !a.read));
      return { ...m, articles: m.articles.map((x) => (x.id === id ? { ...x, read: !x.read } : x)) };
    });
  }, [persist]);

  const positions = useMemo(() => {
    const n = map.articles.length;
    const out: Record<string, Pos> = {};
    map.articles.forEach((a, i) => {
      const frac = layout.starPositions[a.id] ?? defaultStarFrac(i, n);
      out[a.id] = { x: frac.x * dim.w, y: frac.y * dim.h };
    });
    return out;
  }, [map.articles, layout.starPositions, dim]);

  const { w, h } = dim;
  const q = query.trim().toLowerCase();

  return (
    <div ref={wrapRef} className="km-root">
      <style>{KM_CSS}</style>

      <div className="km-top">
        <span className="km-title">Constellation</span>
        <input
          className="km-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="find a star…"
        />
      </div>

      {loading ? (
        <div className="km-empty">Loading your reading…</div>
      ) : map.articles.length === 0 ? (
        <div className="km-empty">
          <h2>Your sky is empty</h2>
          <p>Open an article in the Reader and capture a few links — each article becomes a star.</p>
          <a className="km-btn" href="/reader">Go to the Reader</a>
        </div>
      ) : (
        <svg className="km-svg" width={w} height={h}>
          {map.articleEdges.map((e, i) => {
            const A = positions[e.from], B = positions[e.to];
            if (!A || !B) return null;
            const n = e.shared ?? 1;
            return (
              <line
                key={`e${i}`}
                className="km-edge"
                x1={A.x} y1={A.y} x2={B.x} y2={B.y}
                style={{ strokeWidth: 1 + Math.min(n, 6) * 0.6, opacity: Math.min(0.35 + n * 0.12, 0.95) }}
              >
                <title>{n} shared concept{n === 1 ? '' : 's'}</title>
              </line>
            );
          })}
          {map.articles.map((a) => {
            const p = positions[a.id];
            const state = starState(a);
            const hit = q !== '' && a.label.toLowerCase().includes(q);
            const dimmed = q !== '' && !hit;
            return (
              <g
                key={a.id}
                className={`km-star${dimmed ? ' faded' : ''}${hit ? ' hit' : ''}`}
                transform={`translate(${p.x},${p.y})`}
                onClick={() => onStarClick(a.id)}
              >
                <circle className={`km-starc km-${state}`} r={state === 'read' ? 9 : state === 'discovered' ? 6.5 : 4.5} />
                <text className="km-nl" textAnchor="middle" y={-20}>{a.label}</text>
                {state !== 'dim' && <text className="km-ny" textAnchor="middle" y={28}>{state === 'read' ? 'read' : 'discovered'}</text>}
              </g>
            );
          })}
        </svg>
      )}

      <div className="km-hint">Gold = read · amber = annotated · dim = unread. Click a star to light it up.</div>
    </div>
  );
}

const KM_CSS = `
.km-root{position:relative;width:100%;height:100%;overflow:hidden;
  background:radial-gradient(circle at 30% 18%, hsl(var(--card)), hsl(var(--background)));
  color:hsl(var(--foreground));font-family:'Inter','Segoe UI',system-ui,sans-serif;}
.km-top{position:absolute;top:0;left:0;right:0;z-index:10;padding:.7rem 1rem;display:flex;align-items:center;gap:.8rem;
  background:hsl(var(--background) / 0.85);backdrop-filter:blur(4px);border-bottom:1px solid hsl(var(--border));}
.km-title{font-size:.95rem;font-weight:600;color:hsl(var(--foreground));}
.km-search{margin-left:auto;background:hsl(var(--muted) / 0.4);border:1px solid hsl(var(--border));border-radius:8px;padding:.35rem .6rem;color:hsl(var(--foreground));font-size:.82rem;width:200px;outline:none;}
.km-search:focus{border-color:hsl(var(--ring));}
.km-btn{font-size:.85rem;padding:.4rem .8rem;border-radius:8px;border:1px solid hsl(var(--border));background:hsl(var(--card));color:hsl(var(--muted-foreground));cursor:pointer;text-decoration:none;}
.km-btn:hover{color:hsl(var(--foreground));}
.km-svg{display:block;}
.km-svg text{user-select:none;pointer-events:none;}
.km-edge{stroke:hsl(var(--border));stroke-width:1.4;fill:none;opacity:.8;}
.km-star{cursor:pointer;}
.km-star.faded{opacity:.14;}
.km-starc{transition:r .2s;}
.km-read{fill:hsl(var(--chart-4));filter:drop-shadow(0 0 8px hsl(var(--chart-4) / 0.6));animation:km-pulse 2.6s ease-in-out infinite;}
.km-discovered{fill:hsl(var(--chart-4) / 0.7);filter:drop-shadow(0 0 6px hsl(var(--chart-4) / 0.4));}
.km-dim{fill:hsl(var(--muted-foreground) / 0.35);}
@keyframes km-pulse{0%,100%{opacity:.9}50%{opacity:1}}
.km-nl{fill:hsl(var(--foreground));font-size:13px;font-weight:600;}
.km-ny{fill:hsl(var(--muted-foreground) / 0.85);font-size:10px;}
.km-hint{position:absolute;bottom:.7rem;left:0;right:0;text-align:center;color:hsl(var(--muted-foreground) / 0.85);font-size:.8rem;z-index:5;pointer-events:none;}
.km-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8rem;text-align:center;color:hsl(var(--muted-foreground));padding:2rem;}
.km-empty h2{color:hsl(var(--foreground));font-weight:600;margin:0;}
.km-empty p{max-width:420px;margin:0;font-size:.9rem;line-height:1.5;}
`;
