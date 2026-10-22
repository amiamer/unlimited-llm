/**
 * Unit tests for the Knowledge Map builder.
 * Feature: knowledge-map
 */

import { describe, it, expect } from 'vitest';
import { buildKnowledgeMap, conceptTerm, normalizeKey, edgeId, type ArticleInput } from '../build-map';
import type { Annotation } from '../../reader-workspace/types';
import { emptyLayout, addManualEdge, removeEdge, setConceptYear, setRead } from '../layout-store';

let counter = 0;
function ann(partial: Partial<Annotation>): Annotation {
  counter += 1;
  return {
    id: `a${counter}`,
    docId: 'd',
    startSentenceIndex: 0,
    endSentenceIndex: 0,
    selectedText: 'text',
    comment: '',
    aiReplies: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function article(id: string, title: string, annotations: Annotation[]): ArticleInput {
  return { id, title, type: 'wikipedia', annotations };
}

describe('normalizeKey', () => {
  it('lowercases, collapses spaces/underscores, strips fs-unsafe chars', () => {
    expect(normalizeKey('  Free_Market ')).toBe('free market');
    expect(normalizeKey('Lewis/Clark')).toBe('lewisclark');
    expect(normalizeKey('Curie')).toBe(normalizeKey('curie'));
  });
});

describe('conceptTerm', () => {
  it('uses linkTarget when present, falling back to selectedText', () => {
    expect(conceptTerm(ann({ linkTarget: 'Surplus value', selectedText: 'sv' }))).toBe('Surplus value');
    expect(conceptTerm(ann({ linkTarget: '', selectedText: 'Free market' }))).toBe('Free market');
  });
  it('parses old-style link comments', () => {
    expect(conceptTerm(ann({ comment: 'link', selectedText: 'Monopoly' }))).toBe('Monopoly');
    expect(conceptTerm(ann({ comment: 'link: Finance capital', selectedText: 'fc' }))).toBe('Finance capital');
    expect(conceptTerm(ann({ comment: 'see [[Imperialism]]' }))).toBe('Imperialism');
  });
  it('returns null for plain comments (not concepts)', () => {
    expect(conceptTerm(ann({ comment: 'define this vs. profit' }))).toBeNull();
    expect(conceptTerm(ann({ comment: '' }))).toBeNull();
  });
});

describe('buildKnowledgeMap', () => {
  it('turns articles into stars and link-annotations into concepts', () => {
    const map = buildKnowledgeMap([
      article('Capitalism', 'Capitalism', [
        ann({ linkTarget: 'Free market', selectedText: 'fm' }),
        ann({ linkTarget: 'Surplus value', selectedText: 'sv' }),
        ann({ comment: 'just a note' }),
      ]),
    ]);
    expect(map.articles).toHaveLength(1);
    expect(map.articles[0].concepts.map((c) => c.label)).toEqual(['Free market', 'Surplus value']);
  });

  it('chains concepts in reading order by default', () => {
    const map = buildKnowledgeMap([
      article('A', 'A', [
        ann({ linkTarget: 'one', selectedText: '1' }),
        ann({ linkTarget: 'two', selectedText: '2' }),
        ann({ linkTarget: 'three', selectedText: '3' }),
      ]),
    ]);
    expect(map.articles[0].conceptEdges).toHaveLength(2);
  });

  it('dedupes concepts by normalized term within an article', () => {
    const map = buildKnowledgeMap([
      article('A', 'A', [
        ann({ linkTarget: 'Monopoly' }),
        ann({ linkTarget: 'monopoly' }),
      ]),
    ]);
    expect(map.articles[0].concepts).toHaveLength(1);
  });

  it('adds a constellation edge when a concept targets another article', () => {
    const map = buildKnowledgeMap([
      article('Capitalism', 'Capitalism', [ann({ linkTarget: 'Imperialism' })]),
      article('Imperialism', 'Imperialism', []),
    ]);
    expect(map.articleEdges).toHaveLength(1);
    expect(map.articleEdges[0]).toMatchObject({ from: 'Capitalism', to: 'Imperialism' });
  });

  it('does not add a self-edge when a concept matches its own article', () => {
    const map = buildKnowledgeMap([article('Curie', 'Curie', [ann({ linkTarget: 'Curie' })])]);
    expect(map.articleEdges).toHaveLength(0);
  });

  it('connects two articles that share concepts, case-insensitively, weighted by count', () => {
    const map = buildKnowledgeMap([
      article('A', 'A', [ann({ linkTarget: 'Mercantilism' }), ann({ linkTarget: 'Globalization' }), ann({ linkTarget: 'Only A' })]),
      article('B', 'B', [ann({ linkTarget: 'mercantilism' }), ann({ linkTarget: 'globalization' }), ann({ linkTarget: 'Only B' })]),
    ]);
    expect(map.articleEdges).toHaveLength(1);
    expect(map.articleEdges[0]).toMatchObject({ shared: 2 }); // mercantilism + globalization
  });

  it('merges hidden + manual edges and assigned years from the layout', () => {
    const a1 = ann({ id: 'x1', linkTarget: 'one' });
    const a2 = ann({ id: 'x2', linkTarget: 'two' });
    const a3 = ann({ id: 'x3', linkTarget: 'three' });
    const input = [article('A', 'A', [a1, a2, a3])];

    let layout = emptyLayout();
    // remove the captured one→two edge, add a manual three→one edge, set a year.
    layout = removeEdge(layout, 'A', 'c_x1', 'c_x2');
    layout = addManualEdge(layout, 'A', 'c_x3', 'c_x1');
    layout = setConceptYear(layout, 'A', 'c_x2', 1867);
    layout = setRead(layout, 'A', true);

    const map = buildKnowledgeMap(input, layout);
    const art = map.articles[0];
    expect(art.read).toBe(true);
    expect(art.concepts.find((c) => c.id === 'c_x2')?.year).toBe(1867);

    const ids = art.conceptEdges.map(([x, y]) => edgeId(x, y));
    expect(ids).not.toContain(edgeId('c_x1', 'c_x2')); // hidden
    expect(ids).toContain(edgeId('c_x2', 'c_x3')); // still chained
    expect(ids).toContain(edgeId('c_x3', 'c_x1')); // manual
  });

  it('keeps articles with no concepts as empty territories', () => {
    const map = buildKnowledgeMap([article('Empty', 'Empty', [])]);
    expect(map.articles).toHaveLength(1);
    expect(map.articles[0].concepts).toHaveLength(0);
  });
});
