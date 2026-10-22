/**
 * Unit tests for manual seek/skip in the read-along matcher.
 * Feature: reader-workspace (manual skip addition)
 */

import { describe, it, expect } from 'vitest';
import { createMatcher, seek } from '../matcher';

const SENTENCES = ['One two three.', 'Four five six.', 'Seven eight nine.', 'Ten.'];

describe('matcher seek/skip', () => {
  it('jumps the pointer forward and marks skipped sentences as skimmed', () => {
    const m = createMatcher(SENTENCES);
    const next = seek(m, 2);
    expect(next.pointer).toBe(2);
    expect(next.states[0]).toBe('skimmed');
    expect(next.states[1]).toBe('skimmed');
    expect(next.states[2]).toBe('unread');
  });

  it('skip (seek pointer+1) advances by one', () => {
    const m = createMatcher(SENTENCES);
    const next = seek(m, m.pointer + 1);
    expect(next.pointer).toBe(1);
    expect(next.states[0]).toBe('skimmed');
  });

  it('preserves already-read states when seeking past them', () => {
    const m = createMatcher(SENTENCES);
    const read = { ...m, states: ['read_aloud', 'unread', 'unread', 'unread'] as const };
    const next = seek({ ...m, states: [...read.states] }, 3);
    // index 0 was read_aloud — stays read_aloud; 1,2 were unread — become skimmed.
    expect(next.states[0]).toBe('read_aloud');
    expect(next.states[1]).toBe('skimmed');
    expect(next.states[2]).toBe('skimmed');
    expect(next.pointer).toBe(3);
  });

  it('allows backward jumps (explicit user intent)', () => {
    const m = createMatcher(SENTENCES);
    const forward = seek(m, 3);
    const back = seek(forward, 1);
    expect(back.pointer).toBe(1);
  });

  it('clamps out-of-range indices', () => {
    const m = createMatcher(SENTENCES);
    expect(seek(m, -5).pointer).toBe(0);
    expect(seek(m, 999).pointer).toBe(SENTENCES.length);
  });

  it('resets question mode and window on seek', () => {
    const m = createMatcher(SENTENCES);
    const dirty = { ...m, mode: 'question' as const, pendingUtterance: ['huh'] };
    const next = seek(dirty, 2);
    expect(next.mode).toBe('following');
    expect(next.pendingUtterance).toEqual([]);
  });
});
