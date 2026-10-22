/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for TranscriptReadout.
 * Feature: reader-workspace
 * Requirements: 11.1, 11.2, 11.4, 11.5
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TranscriptReadout } from '../TranscriptReadout';

afterEach(() => cleanup());

describe('TranscriptReadout', () => {
  it('renders nothing when inactive (Req 11.4)', () => {
    const { container } = render(<TranscriptReadout active={false} transcript="hello" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reflects the transcript text when active (Req 11.1)', () => {
    render(<TranscriptReadout active transcript="the history of money" />);
    expect(screen.getByText('the history of money')).toBeInTheDocument();
  });

  it('shows a quiet placeholder and no error when empty (Req 11.5)', () => {
    render(<TranscriptReadout active transcript="" />);
    expect(screen.getByText('Listening…')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('updates when the transcript prop changes (Req 11.2)', () => {
    const { rerender } = render(<TranscriptReadout active transcript="alpha" />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    rerender(<TranscriptReadout active transcript="alpha bravo" />);
    expect(screen.getByText('alpha bravo')).toBeInTheDocument();
  });
});
