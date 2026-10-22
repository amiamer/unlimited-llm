/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for CommentPopover.
 * Feature: reader-workspace
 * Requirements: 2.2, 3.1, 3.2, 3.3
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CommentPopover } from '../CommentPopover';
import type { PendingPopover } from '@/lib/reader-workspace/types';

const pending: PendingPopover = {
  anchor: { startSentenceIndex: 0, endSentenceIndex: 0, selectedText: 'x' },
  rect: { top: 100, left: 50, width: 80, height: 20 },
  text: 'hello',
  linkEnabled: false,
  linkTarget: '',
};

const noop = () => {};

afterEach(() => cleanup());

describe('CommentPopover', () => {
  it('renders one text field and link, copy, AI buttons when onSendToAi is provided', () => {
    render(
      <CommentPopover
        pending={pending}
        onChangeText={noop}
        onCommit={noop}
        onToggleLink={noop}
        onChangeLinkTarget={noop}
        onSendToAi={noop}
      />,
    );
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getAllByRole('button')).toHaveLength(3); // link + copy + AI
    expect(screen.getByLabelText('Copy selected text')).toBeInTheDocument();
  });

  it('renders link and copy buttons when onSendToAi is absent', () => {
    render(
      <CommentPopover
        pending={pending}
        onChangeText={noop}
        onCommit={noop}
        onToggleLink={noop}
        onChangeLinkTarget={noop}
      />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(2); // link + copy
  });

  it('copies the selected text to the clipboard', () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <CommentPopover
        pending={{ ...pending, anchor: { ...pending.anchor, selectedText: 'quote me' } }}
        onChangeText={noop}
        onCommit={noop}
        onToggleLink={noop}
        onChangeLinkTarget={noop}
      />,
    );
    fireEvent.click(screen.getByLabelText('Copy selected text'));
    expect(writeText).toHaveBeenCalledWith('quote me');
  });

  it('does NOT commit when interacting with the field or buttons', () => {
    const onCommit = vi.fn();
    render(
      <CommentPopover
        pending={pending}
        onChangeText={noop}
        onCommit={onCommit}
        onToggleLink={noop}
        onChangeLinkTarget={noop}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('textbox'));
    for (const btn of screen.getAllByRole('button')) fireEvent.mouseDown(btn);

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits on a true outside mousedown', () => {
    const onCommit = vi.fn();
    render(
      <CommentPopover
        pending={pending}
        onChangeText={noop}
        onCommit={onCommit}
        onToggleLink={noop}
        onChangeLinkTarget={noop}
      />,
    );

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('fires onSendToAi when the AI icon button is clicked', () => {
    const onSendToAi = vi.fn();
    render(
      <CommentPopover
        pending={pending}
        onChangeText={noop}
        onCommit={noop}
        onToggleLink={noop}
        onChangeLinkTarget={noop}
        onSendToAi={onSendToAi}
      />,
    );
    fireEvent.click(screen.getByLabelText('Send comment to AI'));
    expect(onSendToAi).toHaveBeenCalledTimes(1);
  });

  it('reports edited text via onChangeText', () => {
    const onChangeText = vi.fn();
    render(
      <CommentPopover
        pending={pending}
        onChangeText={onChangeText}
        onCommit={noop}
        onToggleLink={noop}
        onChangeLinkTarget={noop}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new text' } });
    expect(onChangeText).toHaveBeenCalledWith('new text');
  });

  it('shows link target input when linkEnabled is true', () => {
    render(
      <CommentPopover
        pending={{ ...pending, linkEnabled: true, linkTarget: '' }}
        onChangeText={noop}
        onCommit={noop}
        onToggleLink={noop}
        onChangeLinkTarget={noop}
      />,
    );
    expect(screen.getByLabelText('Wikilink target')).toBeInTheDocument();
  });
});
