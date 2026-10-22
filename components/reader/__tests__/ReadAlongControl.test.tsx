/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for ReadAlongControl.
 * Feature: reader-workspace
 * Requirements: 1.8, 1.9, 1.10
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ReadAlongControl } from '../ReadAlongControl';

afterEach(() => cleanup());

describe('ReadAlongControl', () => {
  it('shows an unsupported indication and no toggle when STT is unsupported', () => {
    render(
      <ReadAlongControl active={false} isSupported={false} onStart={() => {}} onStop={() => {}} />,
    );
    expect(screen.getByRole('note', { name: 'Read-along unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('starts read-along when clicked while inactive', () => {
    const onStart = vi.fn();
    render(
      <ReadAlongControl active={false} isSupported onStart={onStart} onStop={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start read-along' }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('stops read-along when clicked while active', () => {
    const onStop = vi.fn();
    render(
      <ReadAlongControl active isSupported onStart={() => {}} onStop={onStop} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop read-along' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('shows a Skip button only while active and fires onSkip', () => {
    const onSkip = vi.fn();
    const { rerender } = render(
      <ReadAlongControl active={false} isSupported onStart={() => {}} onStop={() => {}} onSkip={onSkip} />,
    );
    // Hidden while inactive.
    expect(screen.queryByRole('button', { name: 'Skip current sentence' })).not.toBeInTheDocument();

    rerender(
      <ReadAlongControl active isSupported onStart={() => {}} onStop={() => {}} onSkip={onSkip} />,
    );
    const skip = screen.getByRole('button', { name: 'Skip current sentence' });
    fireEvent.click(skip);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('shows a Back button only while active and fires onSkipBack', () => {
    const onSkipBack = vi.fn();
    const { rerender } = render(
      <ReadAlongControl active={false} isSupported onStart={() => {}} onStop={() => {}} onSkipBack={onSkipBack} />,
    );
    // Hidden while inactive.
    expect(screen.queryByRole('button', { name: 'Previous sentence' })).not.toBeInTheDocument();

    rerender(
      <ReadAlongControl active isSupported onStart={() => {}} onStop={() => {}} onSkipBack={onSkipBack} />,
    );
    const back = screen.getByRole('button', { name: 'Previous sentence' });
    fireEvent.click(back);
    expect(onSkipBack).toHaveBeenCalledTimes(1);
  });
});
