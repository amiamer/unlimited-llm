'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { Chapter } from '@/lib/types/reader';
import type { Annotation } from '@/lib/reader-workspace/types';
import type { SentenceState } from '@/lib/read-along/types';
import { deriveWordStates } from '@/lib/reader-workspace/word-state';

/**
 * TextDisplay - Displays extracted text with sentence-level highlighting.
 *
 * Renders the book text with `data-sentence-index` attributes so highlights and
 * annotation anchors can key off them. It supports two highlight layers:
 *  - Position: the read-along pointer sentence (or, when read-along is off, the
 *    sentence you clicked) gets an accent underline, and `read_aloud` sentences
 *    carry a neutral trail, via inline `box-decoration-break: clone` styling
 *    (Req 1.3/1.4).
 *  - Persistent annotation highlight: sentences within any annotation's anchor
 *    range are marked; the active thread's passage is emphasized (Req 3.5/4.3/8.5).
 *
 * Selection capture: an `onMouseUp` handler reports a non-empty selection to the
 * parent, which derives the anchor and opens the comment popover (Req 2.1/2.7).
 *
 * Auto-scroll: when read-along is active, the view scrolls only when the pointer
 * sentence drifts out of a comfortable viewport band — not on every change
 * (Req 1.5). All sizing uses rem/px (no `zoom`).
 */

interface TextDisplayProps {
  chapters: Chapter[];
  currentChapter: number;
  currentSentenceIndex: number;
  // Read-along (optional; reader-workspace)
  readAlongActive?: boolean;
  readAlongPointer?: number;
  readAlongStates?: SentenceState[];
  // Annotations (optional; reader-workspace)
  annotations?: Annotation[];
  activeThreadId?: string | null;
  /** Called on a completed non-empty selection within the content. */
  onSelection?: (range: Range, container: HTMLElement) => void;
  /** Called when a sentence is clicked (no active selection) — for jump/skip. */
  onSentenceClick?: (globalIndex: number) => void;
  /**
   * Called when a footnote reference marker (e.g. "[1]") is clicked. The parent
   * resolves the note and shows it inline (anchored to `el`) and/or navigates.
   */
  onFootnoteClick?: (ref: import('@/lib/types/reader').FootnoteRef, el: HTMLElement) => void;
  /** Called when a clicked sentence is covered by an annotation — selects/scrolls to its thread. */
  onAnnotationClick?: (annotationId: string) => void;
  /** External ref to the scroll container (used by CommentMargin for measurement). */
  scrollRef?: React.RefObject<HTMLDivElement>;
  /** Next-expected token index within the current pointer sentence (Req 12). */
  inSentencePos?: number;
  /** Normalized token array of the current pointer sentence (Req 12). */
  currentSentenceTokens?: string[];
  // Article structure (optional; unified-reader). When any of these is provided,
  // the chapter renders in "structured" mode: heading sentences become headings,
  // list items get bullets, and paragraph breaks insert spacing — so a Wikipedia
  // or SEP article keeps its subheadings and formatting.
  headingIndices?: Set<number>;
  listItemIndices?: Set<number>;
  paragraphBreaks?: Set<number>;
}

// Highlight colors come from the reader theme's CSS variables (see
// lib/reader-sources/reader-themes.ts), so they change with the surface
// (charcoal/sepia/forest/etc.). Same meanings as the article view: amber =
// your notes, violet = linked concepts, the accent = where you're reading.
// Fallbacks (after the comma in the var()) cover contexts without the
// variables set.
const ACCENT = 'var(--reader-accent, #b83030)';
// Your position (the read-along sentence, or the one you clicked): a
// whisper-faint tint, paired with an accent underline (set in sentenceStyle) so
// the position is obvious but the text under it stays fully readable.
const POSITION_TINT = `color-mix(in srgb, ${ACCENT} 9%, transparent)`;
const POSITION_UNDERLINE = `inset 0 -0.12em 0 ${ACCENT}`;
// Trail of already-read sentences: neutral + very faint so it recedes.
const READ_ALONG_TRAIL = 'color-mix(in srgb, currentColor 6%, transparent)';
// Annotations: light by default, a touch stronger when the thread is active.
const NOTE_HIGHLIGHT = 'var(--reader-hl-note, #372C11)';
const NOTE_ACTIVE = 'var(--reader-hl-note-active, #57450C)';
const LINK_HIGHLIGHT = 'var(--reader-hl-link, #2D2A43)';
const LINK_ACTIVE = 'var(--reader-hl-link-active, #453D6D)';
// Word-level (Req 12) colors within the current sentence.
const WORD_READ = 'color-mix(in srgb, currentColor 6%, transparent)';
const WORD_CURRENT = `color-mix(in srgb, ${ACCENT} 28%, transparent)`;

export function TextDisplay({
  chapters,
  currentChapter,
  currentSentenceIndex,
  readAlongActive = false,
  readAlongPointer = -1,
  readAlongStates,
  annotations = [],
  activeThreadId = null,
  onSelection,
  onSentenceClick,
  onAnnotationClick,
  onFootnoteClick,
  scrollRef,
  inSentencePos = -1,
  currentSentenceTokens = [],
  headingIndices,
  listItemIndices,
  paragraphBreaks,
}: TextDisplayProps) {
  const internalRef = useRef<HTMLDivElement>(null);
  const containerRef = scrollRef ?? internalRef;
  // "Structured" mode is on when the caller passes article structure metadata.
  const structured = !!(headingIndices || listItemIndices || paragraphBreaks);

  // Auto-scroll: viewport-band behavior. Scroll only when the active sentence
  // drifts above ~20% or below ~70% of the viewport, so reading isn't yanked
  // on every sentence (Req 1.5).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || currentSentenceIndex < 0) return;
    const el = container.querySelector(
      `[data-sentence-index="${currentSentenceIndex}"]`,
    );
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const tooHigh = rect.top < vh * 0.2;
    const tooLow = rect.bottom > vh * 0.7;
    if (tooHigh || tooLow) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentSentenceIndex]);

  const handleMouseUp = useCallback(() => {
    if (!onSelection) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const text = sel.toString().trim();
    if (text.length === 0) return;
    const container = containerRef.current;
    if (!container) return;
    onSelection(sel.getRangeAt(0), container);
  }, [onSelection]);

  // Click a sentence to jump the read-along highlight there. Ignored when the
  // click is part of a text selection (that path opens the comment popover).
  // If the clicked sentence is covered by an annotation, select that thread
  // (scroll-to-comment) instead of seeking.
  const handleSentenceClick = useCallback(
    (globalIndex: number) => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) return;
      // Annotated sentence → open its comment thread (Req: click quote → comment).
      const covering = annotations.find(
        (a) => globalIndex >= a.startSentenceIndex && globalIndex <= a.endSentenceIndex,
      );
      if (covering && onAnnotationClick) {
        onAnnotationClick(covering.id);
        return;
      }
      if (onSentenceClick) onSentenceClick(globalIndex);
    },
    [onSentenceClick, onAnnotationClick, annotations],
  );

  // Map each annotation-covered sentence to how it should be painted, so each
  // sentence span can look up its persistent-highlight style cheaply. The
  // selected thread decides the color of its sentences; otherwise a note wins
  // over a link on overlap.
  const annotationCover = new Map<number, { active: boolean; link: boolean }>();
  for (const a of annotations) {
    const isActive = a.id === activeThreadId;
    const isLink = a.linkTarget !== undefined;
    for (let i = a.startSentenceIndex; i <= a.endSentenceIndex; i++) {
      const prev = annotationCover.get(i);
      if (!prev || isActive || (!prev.active && prev.link && !isLink)) {
        annotationCover.set(i, { active: isActive, link: isLink });
      }
    }
  }

  const sentenceStyle = (globalIndex: number): React.CSSProperties => {
    const style: React.CSSProperties = {
      transition: 'background-color 0.25s ease',
      borderRadius: '2px',
      boxDecorationBreak: 'clone',
      WebkitBoxDecorationBreak: 'clone',
    };

    // Annotation highlight (under read-along).
    const cover = annotationCover.get(globalIndex);
    if (cover) {
      style.backgroundColor = cover.link
        ? cover.active ? LINK_ACTIVE : LINK_HIGHLIGHT
        : cover.active ? NOTE_ACTIVE : NOTE_HIGHLIGHT;
    }

    // Your position: the read-along pointer while read-along runs, otherwise
    // the sentence you clicked (how you check how far through you are).
    const position = readAlongActive ? readAlongPointer : currentSentenceIndex;
    if (globalIndex === position) {
      // Mark it with an ACCENT UNDERLINE rather than a background fill, so the
      // text under it stays fully legible (a fill always cuts contrast on the
      // words). An annotated sentence keeps its highlight; otherwise a
      // whisper-faint tint + the underline reads as "you are here".
      if (!cover) style.backgroundColor = POSITION_TINT;
      style.boxShadow = POSITION_UNDERLINE;
    } else if (readAlongActive && readAlongStates?.[globalIndex] === 'read_aloud' && !cover) {
      // The trail never paints over an annotation highlight.
      style.backgroundColor = READ_ALONG_TRAIL;
    }

    return style;
  };

  // Render a sentence's inner content. For the current pointer sentence during
  // read-along, split into word spans with per-word state (Req 12); otherwise
  // render the plain text. Falls back to plain text when deriveWordStates
  // returns null (count divergence / invalid pos — Req 12.4).
  const renderSentenceContent = (
    globalIndex: number,
    sentence: string,
  ): React.ReactNode => {
    const isCurrentPointer = readAlongActive && globalIndex === readAlongPointer;
    if (!isCurrentPointer) return <>{sentence}{' '}</>;

    const renderedWords = sentence.split(/\s+/).filter(Boolean);
    const wordStates = deriveWordStates(
      renderedWords,
      currentSentenceTokens.length || renderedWords.length,
      inSentencePos,
    );
    if (!wordStates) return <>{sentence}{' '}</>;

    return (
      <>
        {renderedWords.map((word, i) => {
          const st = wordStates[i];
          const bg =
            st === 'current' ? WORD_CURRENT : st === 'read' ? WORD_READ : 'transparent';
          return (
            <span
              key={i}
              style={{
                backgroundColor: bg,
                borderRadius: '2px',
                transition: 'background-color 0.18s ease',
              }}
            >
              {word}{i < renderedWords.length - 1 ? ' ' : ''}
            </span>
          );
        })}{' '}
      </>
    );
  };

  // Render footnote reference markers (e.g. "[1]") as clickable superscript
  // links that jump to the matching note. `localIndex` is the chapter-local
  // flat sentence index (into chapter.sentences).
  const renderFootnotes = (
    chapterFootnotes: Record<number, import('@/lib/types/reader').FootnoteRef[]> | undefined,
    localIndex: number,
  ): React.ReactNode => {
    const refs = chapterFootnotes?.[localIndex];
    if (!refs || refs.length === 0 || !onFootnoteClick) return null;
    return refs.map((r, i) => {
      // Show a clean label inside the pill (strip wrapping brackets/parens),
      // but keep the original for the accessible name.
      const pillText = r.label.replace(/^[[(]\s*/, '').replace(/\s*[\])]$/, '') || r.label;
      return (
        <sup key={`${r.refId}-${i}`} className="footnote-ref">
          <a
            href="#"
            role="doc-noteref"
            aria-label={`Footnote ${r.label}`}
            title="View note"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onFootnoteClick(r, e.currentTarget as HTMLElement);
            }}
          >
            {pillText}
          </a>
        </sup>
      );
    });
  };

  if (chapters.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p>No content available. Please upload an ePub file.</p>
      </div>
    );
  }

  // Calculate global sentence index offset for the current chapter
  let globalSentenceOffset = 0;
  for (let i = 0; i < currentChapter && i < chapters.length; i++) {
    globalSentenceOffset += chapters[i].sentences.length;
  }

  const chapter = chapters[currentChapter];
  if (!chapter) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p>Chapter not found.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="text-display-container" onMouseUp={handleMouseUp}>
      <div className="text-content">
        <h1 className="chapter-title">{chapter.title}</h1>

        <div className="chapter-text">
          {structured ? (
            chapter.sentences.map((sentence, index) => {
              const globalIndex = globalSentenceOffset + index;
              const style = {
                ...sentenceStyle(globalIndex),
                cursor: onSentenceClick ? 'pointer' : undefined,
              };
              if (headingIndices?.has(globalIndex)) {
                return (
                  <h3
                    key={globalIndex}
                    data-sentence-index={globalIndex}
                    className="article-heading"
                    style={style}
                    onClick={() => handleSentenceClick(globalIndex)}
                  >
                    {renderSentenceContent(globalIndex, sentence)}
                  </h3>
                );
              }
              if (listItemIndices?.has(globalIndex)) {
                return (
                  <div
                    key={globalIndex}
                    data-sentence-index={globalIndex}
                    className="article-li"
                    style={style}
                    onClick={() => handleSentenceClick(globalIndex)}
                  >
                    • {renderSentenceContent(globalIndex, sentence)}
                  </div>
                );
              }
              return (
                <span key={globalIndex}>
                  {paragraphBreaks?.has(globalIndex) && globalIndex > globalSentenceOffset && (
                    <><br /><br /></>
                  )}
                  <span
                    data-sentence-index={globalIndex}
                    className="sentence"
                    style={style}
                    onClick={() => handleSentenceClick(globalIndex)}
                  >
                    {renderSentenceContent(globalIndex, sentence)}
                  </span>
                  {renderFootnotes(chapter.footnotes, index)}{' '}
                </span>
              );
            })
          ) : chapter.paragraphs && chapter.paragraphs.length > 0 ? (
            chapter.paragraphs.map((paragraph, paragraphIndex) => {
              return (
                <p key={paragraphIndex} className="paragraph">
                  {paragraph.sentences.map((sentence, sentenceInParagraph) => {
                    let globalIndex = globalSentenceOffset;
                    for (let p = 0; p < paragraphIndex; p++) {
                      globalIndex += chapter.paragraphs[p].sentences.length;
                    }
                    globalIndex += sentenceInParagraph;

                    return (
                      <React.Fragment key={globalIndex}>
                        <span
                          data-sentence-index={globalIndex}
                          className="sentence"
                          style={{ ...sentenceStyle(globalIndex), cursor: onSentenceClick ? 'pointer' : undefined }}
                          onClick={() => handleSentenceClick(globalIndex)}
                        >
                          {renderSentenceContent(globalIndex, sentence)}
                        </span>
                        {renderFootnotes(chapter.footnotes, globalIndex - globalSentenceOffset)}
                      </React.Fragment>
                    );
                  })}
                </p>
              );
            })
          ) : (
            chapter.sentences.map((sentence, index) => {
              const globalIndex = globalSentenceOffset + index;
              return (
                <React.Fragment key={globalIndex}>
                  <span
                    data-sentence-index={globalIndex}
                    className="sentence"
                    style={{ ...sentenceStyle(globalIndex), cursor: onSentenceClick ? 'pointer' : undefined }}
                    onClick={() => handleSentenceClick(globalIndex)}
                  >
                    {renderSentenceContent(globalIndex, sentence)}
                  </span>
                  {renderFootnotes(chapter.footnotes, index)}{' '}
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>

      <style jsx>{`
        .text-display-container {
          width: 100%;
          height: 100%;
          padding: 2rem;
          background: var(--reader-bg, #000000);
        }

        .text-content {
          max-width: 800px;
          margin: 0 auto;
          font-family: var(--reader-font, Georgia, 'Iowan Old Style', 'Times New Roman', serif);
          line-height: 1.8;
          color: var(--reader-text, #e5e7eb);
        }

        .chapter-title {
          font-size: 2rem;
          font-weight: 700;
          margin-bottom: 2rem;
          color: var(--reader-heading, #f9fafb);
          border-bottom: 2px solid #6b1818;
          padding-bottom: 1rem;
        }

        .chapter-text {
          font-size: 1.125rem;
        }

        .paragraph {
          margin-bottom: 1.5rem;
          text-align: justify;
          text-indent: 2rem;
        }

        .paragraph:first-of-type {
          text-indent: 0;
        }

        .sentence {
          transition: background-color 0.3s ease;
        }

        /* Footnote markers render as small tappable pills so they read as
           interactive (not plain text) while staying out of the way of the
           prose. Superscript position keeps them anchored to their word. */
        .footnote-ref {
          font-size: 0.62em;
          line-height: 0;
          margin: 0 0.15em;
          vertical-align: super;
          white-space: nowrap;
        }

        .footnote-ref :global(a) {
          display: inline-block;
          color: var(--reader-accent, #b83030);
          background-color: color-mix(in srgb, var(--reader-accent, #b83030) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--reader-accent, #b83030) 40%, transparent);
          text-decoration: none;
          font-weight: 700;
          cursor: pointer;
          padding: 0.15em 0.4em;
          min-width: 1.1em;
          text-align: center;
          border-radius: 999px;
          transition: background-color 0.15s ease, color 0.15s ease,
            border-color 0.15s ease, transform 0.1s ease;
        }

        .footnote-ref :global(a:hover) {
          background-color: var(--reader-accent, #b83030);
          border-color: var(--reader-accent, #b83030);
          color: #ffffff;
          transform: translateY(-1px);
        }

        .footnote-ref :global(a:active) {
          transform: translateY(0);
        }

        .footnote-ref :global(a:focus-visible) {
          outline: 2px solid var(--reader-accent, #b83030);
          outline-offset: 2px;
        }

        /* Brief flash applied to a note (or a returned-to marker) after a
           footnote jump so the destination is easy to spot. */
        :global(.footnote-flash) {
          animation: footnoteFlash 1.6s ease-out;
        }

        @keyframes footnoteFlash {
          0% { background-color: var(--reader-accent, #b83030); color: #fff; }
          100% { background-color: transparent; }
        }

        .article-heading {
          font-size: 1.45em;
          font-weight: 700;
          line-height: 1.3;
          color: #f9fafb;
          margin: 1.5em 0 0.5em;
          transition: background-color 0.3s ease;
          cursor: pointer;
        }

        .article-li {
          padding-left: 1.5em;
          margin-bottom: 0.35em;
          transition: background-color 0.3s ease;
          cursor: pointer;
        }

        .text-display-container::-webkit-scrollbar {
          width: 0.5rem;
        }

        .text-display-container::-webkit-scrollbar-track {
          background: #000000;
        }

        .text-display-container::-webkit-scrollbar-thumb {
          background: #6b1818;
          border-radius: 0.25rem;
        }

        .text-display-container::-webkit-scrollbar-thumb:hover {
          background: #8b2020;
        }
      `}</style>
    </div>
  );
}
