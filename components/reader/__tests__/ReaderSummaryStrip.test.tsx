/** @vitest-environment jsdom */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderSummaryStrip } from '../ReaderSummaryStrip';

function installLocalStorageMock(): void {
  const backing = new Map<string, string>();
  const storage = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, String(value)),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
    key: (index: number) => Array.from(backing.keys())[index] ?? null,
    get length() { return backing.size; },
  } as Storage;
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
}

describe('ReaderSummaryStrip autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installLocalStorageMock();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('saves every edit locally and syncs after the user pauses', async () => {
    const onCommit = vi.fn(async () => true);
    render(<ReaderSummaryStrip docId="Understanding" chapter={0} onCommit={onCommit} />);

    fireEvent.click(screen.getByText('Summary'));
    const textarea = screen.getByPlaceholderText('Write your running summary here…');
    fireEvent.change(textarea, { target: { value: 'the missing continuation' } });

    expect(window.localStorage.getItem('reader-summary:Understanding:0'))
      .toBe('the missing continuation');
    expect(onCommit).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(screen.getByText('saved + synced')).toBeTruthy();
  });

  it('serializes overlapping commits so the newest text is sent last', async () => {
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const seen: string[] = [];
    const onCommit = vi.fn(async () => {
      seen.push(window.localStorage.getItem('reader-summary:Understanding:0') ?? '');
      if (seen.length === 1) await firstPending;
      return true;
    });
    render(<ReaderSummaryStrip docId="Understanding" chapter={0} onCommit={onCommit} />);

    fireEvent.click(screen.getByText('Summary'));
    const textarea = screen.getByPlaceholderText('Write your running summary here…');
    fireEvent.change(textarea, { target: { value: 'older text' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(seen).toEqual(['older text']);

    fireEvent.change(textarea, { target: { value: 'newest text' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(onCommit).toHaveBeenCalledTimes(1); // queued behind the first request

    await act(async () => {
      releaseFirst();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(['older text', 'newest text']);
  });
});
