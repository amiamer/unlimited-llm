/**
 * Unit tests for the Web Speech STT adapter's pure logic (Phase 2).
 * Feature: read-along-alignment
 *
 * Only `diffCumulative` carries real logic worth testing in isolation — the
 * rest of the adapter is thin browser glue. Web Speech emits CUMULATIVE
 * interim transcripts that revise their own tail, so the diff must handle
 * pure-append AND tail-revision without ever re-emitting matched prefix text.
 */

import { describe, it, expect } from 'vitest';
import { diffCumulative } from '../web-speech-stt';

describe('diffCumulative', () => {
  it('returns the full string when there is no previous text', () => {
    expect(diffCumulative('', 'the federal reserve')).toBe('the federal reserve');
  });

  it('returns empty when nothing changed', () => {
    expect(diffCumulative('the fed', 'the fed')).toBe('');
  });

  it('returns only the appended suffix for pure-append growth', () => {
    expect(diffCumulative('the federal', 'the federal reserve')).toBe(' reserve');
  });

  it('handles incremental word-by-word growth', () => {
    let prev = '';
    const steps = ['the', 'the bank', 'the bank creates', 'the bank creates money'];
    const deltas: string[] = [];
    for (const s of steps) {
      deltas.push(diffCumulative(prev, s));
      prev = s;
    }
    expect(deltas).toEqual(['the', ' bank', ' creates', ' money']);
    // Reassembling deltas reproduces the final transcript exactly.
    expect(deltas.join('')).toBe('the bank creates money');
  });

  it('emits only the revised remainder when the tail is rewritten', () => {
    // Web Speech revised "their" → "there": common prefix is "over the",
    // so the emitted remainder is "re".
    expect(diffCumulative('over their', 'over there')).toBe('re');
  });

  it('emits the revised remainder past the longest common prefix', () => {
    // Common prefix is "two percent of"; current continues "f the top".
    expect(diffCumulative('two percent of', 'two percent off the top')).toBe(
      'f the top',
    );
  });

  it('never re-emits already-consumed prefix on append', () => {
    const prev = 'money creation in the modern economy';
    const next = 'money creation in the modern economy is';
    expect(diffCumulative(prev, next)).toBe(' is');
  });
});
