/**
 * Unit tests for the pure comment-margin layout math.
 * Feature: reader-workspace
 * Requirements: 4.2, 4.4
 */

import { describe, it, expect } from 'vitest';
import { layoutThreads } from '../margin-layout';

describe('layoutThreads', () => {
  it('places non-overlapping threads at their desired offsets', () => {
    const result = layoutThreads(
      [
        { id: 'a', desiredTop: 0, height: 50 },
        { id: 'b', desiredTop: 200, height: 50 },
      ],
      8,
    );
    expect(result).toEqual([
      { id: 'a', top: 0 },
      { id: 'b', top: 200 },
    ]);
  });

  it('pushes down a thread that would overlap the previous one', () => {
    const result = layoutThreads(
      [
        { id: 'a', desiredTop: 0, height: 100 },
        { id: 'b', desiredTop: 50, height: 40 }, // would overlap a (ends at 108)
      ],
      8,
    );
    expect(result[0].top).toBe(0);
    // b pushed to a.top + a.height + gap = 0 + 100 + 8 = 108.
    expect(result[1].top).toBe(108);
  });

  it('never places a thread above its desired offset', () => {
    const result = layoutThreads(
      [
        { id: 'a', desiredTop: 0, height: 20 },
        { id: 'b', desiredTop: 500, height: 20 },
      ],
      8,
    );
    expect(result[1].top).toBe(500);
  });

  it('cascades multiple overlaps', () => {
    const result = layoutThreads(
      [
        { id: 'a', desiredTop: 0, height: 100 },
        { id: 'b', desiredTop: 10, height: 100 },
        { id: 'c', desiredTop: 20, height: 100 },
      ],
      10,
    );
    expect(result[0].top).toBe(0);
    expect(result[1].top).toBe(110); // 0 + 100 + 10
    expect(result[2].top).toBe(220); // 110 + 100 + 10
  });
});
