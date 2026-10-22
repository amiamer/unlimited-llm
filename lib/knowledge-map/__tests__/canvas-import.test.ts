/**
 * Unit tests for Obsidian Canvas import/export.
 * Feature: knowledge-map
 */

import { describe, it, expect } from 'vitest';
import {
  parseYear,
  splitTitleDesc,
  importCanvas,
  type RawCanvas,
} from '../canvas-import';

describe('parseYear', () => {
  it('reads parenthetical spans, taking the first year', () => {
    expect(parseYear('kant (1724 - 1804)')).toBe(1724);
    expect(parseYear('darwin (1809–1882)')).toBe(1809);
  });
  it('handles BCE', () => {
    expect(parseYear('socrates (469 - 399 BCE)')).toBe(-469);
    expect(parseYear('Democritus (c.460–370 BCE) Atomism')).toBe(-460);
  });
  it('reads bare leading event years and centuries', () => {
    expect(parseYear('1848 Revolutions across Europe')).toBe(1848);
    expect(parseYear('19TH CENTURY')).toBe(1800);
  });
  it('returns null when no year is present', () => {
    expect(parseYear('some idea with no date')).toBeNull();
    expect(parseYear('')).toBeNull();
  });
});

describe('splitTitleDesc', () => {
  it('splits on the first close-paren for dated figures', () => {
    const { title, desc } = splitTitleDesc('Plotinus (204–270 CE) Neoplatonism. Mystical hierarchy.');
    expect(title).toBe('Plotinus (204–270 CE)');
    expect(desc).toContain('Neoplatonism');
  });
});

const RAW: RawCanvas = {
  nodes: [
    { id: 'era1', type: 'text', text: 'ANCIENT 500 BCE – 500 CE', x: 0, y: -300, width: 200, height: 50, color: '1' },
    { id: 'soc', type: 'text', text: 'socrates (469 - 399 BCE)', x: 0, y: 0, width: 250, height: 60 },
    { id: 'darwin', type: 'text', text: 'darwin (1809–1882)', x: 1000, y: 0, width: 250, height: 60, color: '6' },
    { id: 'undated', type: 'text', text: 'a thought with no year', x: 500, y: 500, width: 250, height: 60 },
    { id: 'grp', type: 'group', x: 0, y: 0, width: 10, height: 10 },
  ],
  edges: [
    { id: 'e0', fromNode: 'soc', toNode: 'darwin' },
    { id: 'e1', fromNode: 'soc', toNode: 'undated' }, // dropped: undated isn't a node
  ],
};

describe('importCanvas', () => {
  it('keeps dated text nodes, pulls era headers out, drops the rest', () => {
    const c = importCanvas(RAW);
    expect(c.nodes.map((n) => n.id)).toEqual(['soc', 'darwin']);
    expect(c.eras).toEqual([{ label: 'ANCIENT 500 BCE – 500 CE', year: -500 }]);
  });
  it('keeps only edges between kept nodes', () => {
    const c = importCanvas(RAW);
    expect(c.edges).toEqual([['soc', 'darwin']]);
  });
  it('preserves original canvas position + colour for copy-what-you-have', () => {
    const darwin = importCanvas(RAW).nodes.find((n) => n.id === 'darwin')!;
    expect(darwin).toMatchObject({ x: 1000, y: 0, color: '6', year: 1809 });
  });
});
