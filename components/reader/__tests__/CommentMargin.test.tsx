/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for CommentMargin + CommentThread.
 * Feature: reader-workspace
 * Requirements: 4.4, 5.1, 5.3, 5.5, 5.6
 */

import React, { useRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CommentMargin } from '../CommentMargin';
import { CommentThread } from '../CommentThread';
import type { Annotation } from '@/lib/reader-workspace/types';

afterEach(() => cleanup());

const noop = () => {};

function annotation(id: string, startIdx: number): Annotation {
  return {
    id,
    docId: 'doc',
    startSentenceIndex: startIdx,
    endSentenceIndex: startIdx,
    selectedText: `passage ${id}`,
    comment: `comment ${id}`,
    aiReplies: [],
    createdAt: 't',
    updatedAt: 't',
  };
}

function Host({ annotations }: { annotations: Annotation[] }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={ref} data-testid="scroll">
        {annotations.map((a) => (
          <span key={a.id} data-sentence-index={a.startSentenceIndex}>
            s{a.startSentenceIndex}
          </span>
        ))}
      </div>
      <CommentMargin
        annotations={annotations}
        activeThreadId={null}
        aiStatus={{}}
        syncStatus={{}}
        scrollContainerRef={ref}
        onSelectThread={noop}
        onRequestAi={noop}
        onEdit={noop}
        onEditSelectedText={noop}
        onDelete={noop}
        onRetrySync={noop}
      />
    </div>
  );
}

describe('CommentMargin', () => {
  it('renders a thread per annotation without overlapping positions', () => {
    const protoRect = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
      toJSON: () => {},
    } as DOMRect);
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() { return 60; },
    });

    const annotations = [annotation('a', 0), annotation('b', 1)];
    render(<Host annotations={annotations} />);

    const threads = screen.getAllByRole('group', { name: 'Comment thread' });
    expect(threads).toHaveLength(2);

    vi.mocked(Element.prototype.getBoundingClientRect).mockRestore?.();
    Element.prototype.getBoundingClientRect = protoRect;
  });
});

describe('CommentThread — AI flow', () => {
  it('AI-send icon triggers a request; pending then reply shows', () => {
    const onRequestAi = vi.fn();
    const a = annotation('a', 0);

    // Controls (Send to AI, edit, delete, follow-up) render only on the
    // SELECTED thread — idle threads are just quote + note.
    const { rerender } = render(
      <CommentThread annotation={a} active={true} aiState="idle" syncState="idle"
        onSelect={noop} onRequestAi={onRequestAi} onEdit={noop} onEditSelectedText={noop}
        onDelete={noop} onRetrySync={noop} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send to AI' }));
    expect(onRequestAi).toHaveBeenCalledTimes(1);

    rerender(
      <CommentThread annotation={a} active={false} aiState="pending" syncState="idle"
        onSelect={noop} onRequestAi={onRequestAi} onEdit={noop} onEditSelectedText={noop}
        onDelete={noop} onRetrySync={noop} />,
    );
    expect(screen.getByLabelText('AI is responding')).toBeInTheDocument();

    const withReply: Annotation = {
      ...a,
      aiReplies: [{ id: 'r1', content: 'the answer', createdAt: 't' }],
    };
    rerender(
      <CommentThread annotation={withReply} active={false} aiState="idle" syncState="idle"
        onSelect={noop} onRequestAi={onRequestAi} onEdit={noop} onEditSelectedText={noop}
        onDelete={noop} onRetrySync={noop} />,
    );
    expect(screen.getByText('the answer')).toBeInTheDocument();
  });

  it('shows an error and a retry on Obsidian sync failure', () => {
    const onRetrySync = vi.fn();
    render(
      <CommentThread annotation={annotation('a', 0)} active={false} aiState="idle" syncState="error"
        onSelect={noop} onRequestAi={noop} onEdit={noop} onEditSelectedText={noop}
        onDelete={noop} onRetrySync={onRetrySync} />,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Retry')).toBeInTheDocument();
    fireEvent.click(within(alert).getByText('Retry'));
    expect(onRetrySync).toHaveBeenCalledTimes(1);
  });

  it('AI error state surfaces in-thread', () => {
    render(
      <CommentThread annotation={annotation('a', 0)} active={false} aiState="error" syncState="idle"
        onSelect={noop} onRequestAi={noop} onEdit={noop} onEditSelectedText={noop}
        onDelete={noop} onRetrySync={noop} />,
    );
    expect(screen.getByText('AI request failed.')).toBeInTheDocument();
  });
});
