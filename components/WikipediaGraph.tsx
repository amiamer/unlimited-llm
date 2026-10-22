/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getSubPages, getRandomArticle, getSuggestions, getNormalizedId } from '@/lib/wikipedia-graph';

// ── Types ──────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  level: number;
  color: string;
  parent: string;
  x?: number;
  y?: number;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  color: string | { inherit: string };
  level: number;
  width?: number;
}

// ── Color helpers ──────────────────────────────────────────────────────────

function hexToRGB(hex: string): number[] {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

function rgbToHex(rgb: number[]): string {
  return '#' + rgb.map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
}

function lightenHex(hex: string, percent: number): string {
  const rgb = hexToRGB(hex);
  return rgbToHex(rgb.map(x => x + (Math.min(percent, 100) / 100) * (255 - x)));
}

function getNodeColor(level: number): string {
  return lightenHex('#03A9F4', 5 * level);
}

function getHighlightColor(level: number): string {
  return lightenHex('#FFC107', 5 * level);
}

function wordwrap(text: string, limit: number): string {
  const words = text.split(' ');
  if (!words.length) return text;
  const lines = [words[0]];
  words.slice(1).forEach(word => {
    if (lines[lines.length - 1].length + word.length > limit) lines.push(word);
    else lines[lines.length - 1] += ` ${word}`;
  });
  return lines.join('\n');
}

// ── Suggestions dropdown ───────────────────────────────────────────────────

function WikiSuggestions({ query, show, onSelect }: {
  query: string; show: boolean; onSelect: (v: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!query.trim()) { setSuggestions([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      getSuggestions(query)
        .then(s => { if (!cancelled) setSuggestions(s); })
        .catch(() => { if (!cancelled) setSuggestions([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  if (!show || !suggestions.length) return null;

  return (
    <div className="absolute z-50 w-full mt-1 bg-navy-red-800 border border-navy-red-600 rounded-lg shadow-xl max-h-60 overflow-y-auto">
      {suggestions.map((s, i) => (
        <div key={i} onMouseDown={() => onSelect(s)}
          className="px-4 py-2.5 hover:bg-navy-red-700 cursor-pointer text-gray-200 text-sm border-b border-navy-red-700 last:border-b-0 transition-colors">
          {s}
        </div>
      ))}
    </div>
  );
}

// ── Topic tags bar ─────────────────────────────────────────────────────────

function TopicTags({ topics, expanded, onRemove, onFocus }: {
  topics: { id: string; label: string }[];
  expanded: Set<string>;
  onRemove: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  if (!topics.length) return null;
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 bg-navy-red-800/60 border-b border-navy-red-700 overflow-x-auto">
      {topics.map(t => (
        <span key={t.id}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer transition-colors ${
            expanded.has(t.id)
              ? 'bg-blue-900/50 text-blue-300 border border-blue-700/50'
              : 'bg-navy-red-700 text-gray-300 border border-navy-red-600 hover:bg-navy-red-600'
          }`}
          onClick={() => onFocus(t.id)}
        >
          {t.label}
          {expanded.has(t.id) && <span className="text-blue-500/60 text-[10px]">✓</span>}
          <button onClick={(e) => { e.stopPropagation(); onRemove(t.id); }}
            className="ml-0.5 text-gray-500 hover:text-red-400 transition-colors">×</button>
        </span>
      ))}
    </div>
  );
}

// ── Stats bar ──────────────────────────────────────────────────────────────

function StatsBar({ nodeCount, edgeCount, expandedCount }: {
  nodeCount: number; edgeCount: number; expandedCount: number;
}) {
  if (nodeCount === 0) return null;
  return (
    <div className="flex gap-4 text-xs text-gray-400 px-4 py-2 bg-navy-red-800/50 border-t border-navy-red-700">
      <span>{nodeCount} nodes</span>
      <span>{edgeCount} edges</span>
      <span>{expandedCount} expanded</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function WikipediaGraph() {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<any>(null);
  const nodesRef = useRef<any>(null);
  const edgesRef = useRef<any>(null);

  const [query, setQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingNode, setLoadingNode] = useState<string | null>(null);
  const [startPages, setStartPages] = useState<string[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [, setInitialized] = useState(false);
  const [tracebackPath, setTracebackPath] = useState<string[]>([]);

  // Use refs for values needed inside event handlers to avoid stale closures
  const expandedRef = useRef(expandedNodes);
  expandedRef.current = expandedNodes;
  const startPagesRef = useRef(startPages);
  startPagesRef.current = startPages;

  const updateStats = useCallback(() => {
    if (nodesRef.current && edgesRef.current) {
      setNodeCount(nodesRef.current.length);
      setEdgeCount(edgesRef.current.length);
    }
  }, []);

  // ── Expand a node ──────────────────────────────────────────────────────

  const expandNodeRef = useRef<(nodeId: string) => Promise<void>>();

  const expandNode = useCallback(async (nodeId: string) => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    console.log('[wiki-graph] expandNode called', nodeId, 'nodes:', !!nodes, 'edges:', !!edges);
    if (!nodes || !edges) return;

    const node: GraphNode | null = nodes.get(nodeId);
    console.log('[wiki-graph] node found:', node);
    if (!node) return;

    // Already expanded? Skip.
    if (expandedRef.current.has(nodeId)) {
      console.log('[wiki-graph] already expanded, skipping');
      return;
    }

    setLoadingNode(nodeId);
    try {
      const pageName = node.label.replace(/\n/g, ' ');
      console.log('[wiki-graph] fetching subpages for:', pageName);
      const { redirectedTo, links } = await getSubPages(pageName);
      console.log('[wiki-graph] got links:', links.length, 'redirected to:', redirectedTo);

      const newId = getNormalizedId(redirectedTo);
      let actualId = nodeId;
      if (newId !== nodeId) {
        const edgeList: GraphEdge[] = edges.get();
        const edgeUpdates = edgeList
          .filter((e: GraphEdge) => e.from === nodeId || e.to === nodeId)
          .map((e: GraphEdge) => ({
            ...e,
            from: e.from === nodeId ? newId : e.from,
            to: e.to === nodeId ? newId : e.to,
          }));
        edges.update(edgeUpdates);

        if (nodes.get(newId)) {
          nodes.remove(nodeId);
        } else {
          nodes.remove(nodeId);
          nodes.add({ ...node, id: newId, label: wordwrap(redirectedTo, 15) });
        }
        actualId = newId;
        setStartPages(prev => prev.map(sp => sp === nodeId ? newId : sp));
      }

      const level = (node.level ?? 0) + 1;
      const existingIds = new Set<string>(nodes.getIds());
      const newNodes: GraphNode[] = [];
      const newEdges: GraphEdge[] = [];

      for (const link of links) {
        const linkId = getNormalizedId(link);
        if (!existingIds.has(linkId)) {
          newNodes.push({
            id: linkId, label: wordwrap(link, 15), level,
            color: getNodeColor(level), parent: actualId,
          });
          existingIds.add(linkId);
        }
        const dupeEdge = edges.get({ filter: (e: GraphEdge) => e.from === actualId && e.to === linkId });
        if (dupeEdge.length === 0) {
          newEdges.push({
            id: `${actualId}->${linkId}`, from: actualId, to: linkId,
            color: getNodeColor(level), level,
          });
        }
      }

      nodes.add(newNodes);
      edges.add(newEdges);
      setExpandedNodes(prev => { const next = new Set(Array.from(prev)); next.add(actualId); return next; });
      updateStats();
    } catch (err) {
      console.error('Failed to expand node:', err);
    } finally {
      setLoadingNode(null);
    }
  }, [updateStats]);

  expandNodeRef.current = expandNode;

  // ── Traceback helpers ──────────────────────────────────────────────────

  const highlightTraceback = useCallback((nodeId: string) => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (!nodes || !edges) return;

    // Reset all
    const allNodes: GraphNode[] = nodes.get();
    nodes.update(allNodes.map((n: GraphNode) => ({ id: n.id, color: getNodeColor(n.level) })));
    const allEdges: GraphEdge[] = edges.get();
    edges.update(allEdges.map((e: GraphEdge) => ({ id: e.id, width: 1.5, color: getNodeColor(e.level) })));

    // Build path back to start
    const path: string[] = [];
    let current: string | undefined = nodeId;
    let iterations = 0;
    while (current && iterations < 100) {
      path.push(current);
      const n: GraphNode | null = nodes.get(current);
      if (!n || startPagesRef.current.includes(current)) break;
      current = n.parent;
      iterations++;
    }
    setTracebackPath(path);

    // Highlight nodes
    nodes.update(path.map(id => {
      const n: GraphNode | null = nodes.get(id);
      return { id, color: getHighlightColor(n?.level ?? 0) };
    }));

    // Highlight edges
    for (let i = 0; i < path.length - 1; i++) {
      const el = edges.get({
        filter: (e: GraphEdge) =>
          (e.from === path[i] && e.to === path[i + 1]) ||
          (e.from === path[i + 1] && e.to === path[i]),
      });
      if (el.length > 0) {
        edges.update([{ id: el[0].id, width: 5, color: { inherit: 'to' } }]);
      }
    }
  }, []);

  const resetHighlight = useCallback(() => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (!nodes || !edges) return;
    setTracebackPath([]);
    const allNodes: GraphNode[] = nodes.get();
    nodes.update(allNodes.map((n: GraphNode) => ({ id: n.id, color: getNodeColor(n.level) })));
    const allEdges: GraphEdge[] = edges.get();
    edges.update(allEdges.map((e: GraphEdge) => ({ id: e.id, width: 1.5, color: getNodeColor(e.level) })));
  }, []);

  // ── Initialize vis-network + bind events in one effect ─────────────────

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    (async () => {
      const vis = await import('vis-network/standalone');
      const { DataSet } = await import('vis-data/standalone');
      if (destroyed || !containerRef.current) return;

      const nodes = new DataSet<GraphNode>([]);
      const edges = new DataSet<GraphEdge>([]);
      nodesRef.current = nodes;
      edgesRef.current = edges;

      const network = new vis.Network(containerRef.current, { nodes, edges }, {
        nodes: {
          shape: 'dot',
          size: 25,
          font: { size: 14, color: '#e5e7eb', face: 'system-ui, sans-serif' },
          borderWidth: 2,
          shadow: { enabled: true, color: 'rgba(0,0,0,0.3)', size: 8 },
        },
        edges: {
          smooth: { enabled: true, type: 'continuous', roundness: 0.5 },
          width: 1.5, selectionWidth: 2, hoverWidth: 0,
        },
        interaction: {
          hover: true, hoverConnectedEdges: false,
          selectConnectedEdges: true, tooltipDelay: 200,
        },
        physics: {
          solver: 'forceAtlas2Based',
          forceAtlas2Based: {
            gravitationalConstant: -40, centralGravity: 0.005,
            springLength: 200, springConstant: 0.08, damping: 0.4,
          },
          stabilization: { iterations: 100 },
        },
      });

      networkRef.current = network;

      // Bind events directly — use refs to avoid stale closures
      network.on('click', (params: any) => {
        console.log('[wiki-graph] click event', params.nodes);
        if (params.nodes.length) {
          console.log('[wiki-graph] expanding node', params.nodes[0], 'ref exists:', !!expandNodeRef.current);
          expandNodeRef.current?.(params.nodes[0]);
        } else {
          resetHighlight();
        }
      });

      network.on('hoverNode', (params: any) => {
        highlightTraceback(params.node);
      });

      network.on('blurNode', () => {
        resetHighlight();
      });

      network.on('doubleClick', (params: any) => {
        if (params.nodes.length) {
          const node: GraphNode | null = nodes.get(params.nodes[0]) as any;
          if (node) {
            const page = encodeURIComponent(node.label.replace(/\n/g, ' '));
            window.open(`https://en.wikipedia.org/wiki/${page}`, '_blank');
          }
        }
      });

      setInitialized(true);
    })();

    return () => {
      destroyed = true;
      networkRef.current?.destroy();
      networkRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Add / remove start nodes ───────────────────────────────────────────

  const addStartNode = useCallback((pageName: string) => {
    const nodes = nodesRef.current;
    if (!nodes || !networkRef.current) return;

    const id = getNormalizedId(pageName);
    if (nodes.get(id)) return;

    nodes.add({
      id, label: wordwrap(pageName, 20), level: 0,
      color: getNodeColor(0), parent: id, x: 0, y: 0,
    });
    setStartPages(prev => [...prev, id]);
    updateStats();
    setTimeout(() => { try { networkRef.current?.fit({ animation: true }); } catch {} }, 300);
  }, [updateStats]);

  const removeStartNode = useCallback((id: string) => {
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (!nodes || !edges) return;

    // Remove the node and all its descendant edges/nodes
    // For simplicity, just remove the node and its direct edges
    const connectedEdges: GraphEdge[] = edges.get({
      filter: (e: GraphEdge) => e.from === id || e.to === id,
    });
    edges.remove(connectedEdges.map(e => e.id));
    nodes.remove(id);
    setStartPages(prev => prev.filter(sp => sp !== id));
    setExpandedNodes(prev => { const next = new Set(Array.from(prev)); next.delete(id); return next; });
    updateStats();
  }, [updateStats]);

  const focusNode = useCallback((id: string) => {
    const network = networkRef.current;
    if (!network) return;
    network.focus(id, { scale: 1.2, animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
    network.selectNodes([id]);
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleGo = useCallback(() => {
    if (!query.trim()) return;
    setShowSuggestions(false);
    addStartNode(query.trim());
    setQuery('');
  }, [query, addStartNode]);

  const handleRandom = useCallback(async () => {
    setLoading(true);
    try {
      const title = await getRandomArticle();
      addStartNode(title);
    } catch (err) {
      console.error('Failed to get random article:', err);
    } finally {
      setLoading(false);
    }
  }, [addStartNode]);

  const handleClear = useCallback(() => {
    nodesRef.current?.clear();
    edgesRef.current?.clear();
    setStartPages([]);
    setExpandedNodes(new Set());
    setTracebackPath([]);
    updateStats();
  }, [updateStats]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleGo(); }
  };

  // Build topic list from startPages + node labels
  const topicList = startPages.map(id => ({
    id,
    label: nodesRef.current?.get(id)?.label?.replace(/\n/g, ' ') ?? id,
  }));

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-navy-red-900">
      {/* Top bar */}
      <div className="flex items-center gap-2 p-3 bg-navy-red-800/80 backdrop-blur border-b border-navy-red-700 z-10">
        <div className="relative flex-1 max-w-xl">
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            onKeyDown={handleKeyDown}
            placeholder="Search Wikipedia..."
            className="w-full px-4 py-2 bg-navy-red-900 border border-navy-red-600 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm"
          />
          <WikiSuggestions
            query={query}
            show={showSuggestions}
            onSelect={(v) => { setShowSuggestions(false); addStartNode(v); setQuery(''); }}
          />
        </div>

        <button onClick={handleGo} disabled={!query.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors">
          Go
        </button>

        <button onClick={handleRandom} disabled={loading}
          className="px-3 py-2 bg-navy-red-700 hover:bg-navy-red-600 text-gray-300 rounded-lg text-sm transition-colors"
          title="Random article">
          {loading ? (
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeLinecap="round" />
            </svg>
          ) : '🎲'}
        </button>

        {startPages.length > 0 && (
          <button onClick={handleClear}
            className="px-3 py-2 bg-navy-red-700 hover:bg-red-900/50 text-gray-400 hover:text-red-400 rounded-lg text-sm transition-colors"
            title="Clear graph">
            🗑️
          </button>
        )}

        <a href="/wikipedia"
          className="px-3 py-2 bg-navy-red-700 hover:bg-navy-red-600 text-gray-400 rounded-lg text-sm transition-colors"
          title="Wikipedia Reader">
          📖
        </a>
      </div>

      {/* Topic tags */}
      <TopicTags topics={topicList} expanded={expandedNodes} onRemove={removeStartNode} onFocus={focusNode} />

      {/* Loading indicator */}
      {loadingNode && (
        <div className="px-4 py-1.5 bg-blue-900/30 border-b border-blue-800/30 text-blue-300 text-xs">
          Expanding &ldquo;{nodesRef.current?.get(loadingNode)?.label?.replace(/\n/g, ' ') ?? loadingNode}&rdquo;...
        </div>
      )}

      {/* Traceback breadcrumb */}
      {tracebackPath.length > 1 && (
        <div className="px-4 py-1.5 bg-yellow-900/20 border-b border-yellow-800/20 text-yellow-300/80 text-xs flex items-center gap-1 overflow-x-auto">
          <span className="text-yellow-500/60 shrink-0">Path:</span>
          {[...tracebackPath].reverse().map((id, i) => (
            <span key={id} className="flex items-center gap-1 shrink-0">
              {i > 0 && <span className="text-yellow-600/40">→</span>}
              <span>{nodesRef.current?.get(id)?.label?.replace(/\n/g, ' ') ?? id}</span>
            </span>
          ))}
        </div>
      )}

      {/* Graph container */}
      <div className="flex-1 relative min-h-0">
        <div ref={containerRef} className="absolute inset-0" />

        {nodeCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center space-y-3">
              <h1 className="text-3xl font-light text-gray-300">Wikipedia Graph</h1>
              <p className="text-gray-500 max-w-md">
                Search for a topic to start exploring connections between Wikipedia articles.
                Click nodes to expand them, hover to trace paths back.
              </p>
              <p className="text-gray-600 text-xs">Double-click a node to open the Wikipedia article.</p>
            </div>
          </div>
        )}
      </div>

      <StatsBar nodeCount={nodeCount} edgeCount={edgeCount} expandedCount={expandedNodes.size} />
    </div>
  );
}
