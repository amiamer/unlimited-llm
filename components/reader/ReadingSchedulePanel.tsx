'use client';

import React from 'react';
import type { ResolvedScheduleItem } from '@/lib/reader-workspace/reading-schedule';

/**
 * ReadingSchedulePanel — shows a reading-group's deadline schedule pinned to
 * the book's structural boundaries (Volume/Part starts), since an EPUB has no
 * page numbers. Each row is a deadline; clicking it jumps to the chapter where
 * that week's reading ends. The row the reader is currently working toward is
 * highlighted, and completed weeks are dimmed with a check.
 */
interface ReadingSchedulePanelProps {
  scheduleTitle: string;
  items: ResolvedScheduleItem[];
  /** Index of the item currently being read toward (from currentScheduleItem). */
  currentIndex: number;
  /** Current chapter index, to compute per-week completion. */
  currentChapter: number;
  /**
   * Fractional progress through the CURRENT chapter (0..1), from the reader's
   * sentence position. Makes the weekly progress bar smooth instead of jumping
   * in whole-chapter steps.
   */
  chapterProgress?: number;
  /** Jump the reader to a chapter (the week's starting boundary). */
  onJumpToChapter: (chapterIndex: number) => void;
}

export function ReadingSchedulePanel({
  scheduleTitle,
  items,
  currentIndex,
  currentChapter,
  chapterProgress = 0,
  onJumpToChapter,
}: ReadingSchedulePanelProps) {
  if (items.length === 0) return null;

  return (
    <div className="reading-schedule">
      <div className="rs-header">
        <span className="rs-title">Reading Schedule</span>
        <span className="rs-sub">{scheduleTitle}</span>
      </div>

      <ol className="rs-list">
        {items.map((item, i) => {
          const done = currentChapter > item.boundaryChapterIndex;
          const current = i === currentIndex;
          const state = done ? 'done' : current ? 'current' : 'upcoming';

          // Progress through the CURRENT week: how far currentChapter has moved
          // from the week's start toward its end (inclusive of the end chapter).
          let pct: number | null = null;
          if (current) {
            const span = item.boundaryChapterIndex - item.startChapterIndex + 1;
            // Whole chapters completed within this week, plus the fractional
            // progress through the chapter currently being read.
            const wholeDone = Math.min(
              Math.max(currentChapter - item.startChapterIndex, 0),
              span,
            );
            const frac =
              currentChapter >= item.startChapterIndex &&
              currentChapter <= item.boundaryChapterIndex
                ? Math.min(Math.max(chapterProgress, 0), 1)
                : 0;
            pct = span > 0 ? Math.round(((wholeDone + frac) / span) * 100) : 0;
            pct = Math.min(pct, 100);
          }

          return (
            <li key={item.date} className={`rs-item ${state}`}>
              <button
                type="button"
                className="rs-row"
                onClick={() => onJumpToChapter(item.startChapterIndex)}
                title={`Jump to the start of “${item.label}”`}
              >
                <span className="rs-mark" aria-hidden>
                  {done ? '✓' : current ? '▸' : '○'}
                </span>
                <span className="rs-body">
                  <span className="rs-line1">
                    <span className="rs-date">{item.date}</span>
                    <span className="rs-label">{item.label}</span>
                  </span>
                  {item.pages && <span className="rs-pages">{item.pages}</span>}
                  {current && pct !== null && (
                    <span className="rs-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <span className="rs-progress-fill" style={{ width: `${pct}%` }} />
                      <span className="rs-progress-text">{pct}% through this week</span>
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <p className="rs-note">
        No page numbers in EPUB — each date jumps to where that week&apos;s reading starts.
      </p>

      <style jsx>{`
        .reading-schedule {
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.6rem;
          padding: 0.6rem 0.6rem 0.5rem;
          color: #c8c4c0;
          background: rgba(255, 255, 255, 0.02);
        }
        .rs-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .rs-title {
          font-weight: 700;
          font-size: 0.9rem;
          color: #f3efe9;
        }
        .rs-sub {
          font-size: 0.72rem;
          opacity: 0.6;
          text-align: right;
        }
        .rs-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .rs-row {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          width: 100%;
          text-align: left;
          background: transparent;
          border: none;
          color: inherit;
          cursor: pointer;
          padding: 0.35rem 0.4rem;
          border-radius: 0.4rem;
          transition: background-color 0.15s ease;
        }
        .rs-row:hover {
          background: rgba(255, 255, 255, 0.06);
        }
        .rs-mark {
          flex: 0 0 auto;
          width: 1.1em;
          text-align: center;
          font-size: 0.85rem;
          line-height: 1.5;
        }
        .rs-body {
          display: flex;
          flex-direction: column;
          gap: 0.05rem;
          min-width: 0;
        }
        .rs-line1 {
          display: flex;
          gap: 0.5rem;
          align-items: baseline;
        }
        .rs-date {
          font-weight: 700;
          font-size: 0.82rem;
          color: var(--reader-accent, #d06a5a);
          flex: 0 0 auto;
        }
        .rs-label {
          font-size: 0.82rem;
          line-height: 1.35;
        }
        .rs-pages {
          font-size: 0.7rem;
          opacity: 0.55;
        }

        /* States */
        .rs-item.done .rs-label,
        .rs-item.done .rs-date {
          opacity: 0.5;
        }
        .rs-item.done .rs-mark {
          color: #3a9e6a;
        }
        .rs-item.current .rs-row {
          background: color-mix(in srgb, var(--reader-accent, #b83030) 16%, transparent);
        }
        .rs-item.current .rs-mark {
          color: var(--reader-accent, #d06a5a);
        }

        .rs-progress {
          display: block;
          position: relative;
          margin-top: 0.3rem;
          height: 0.85rem;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          overflow: hidden;
        }
        .rs-progress-fill {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          background: var(--reader-accent, #b83030);
          border-radius: 999px;
          transition: width 0.35s ease;
        }
        .rs-progress-text {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.6rem;
          font-weight: 600;
          color: #f3efe9;
          text-shadow: 0 0 3px rgba(0, 0, 0, 0.6);
          white-space: nowrap;
        }

        .rs-note {
          margin: 0.5rem 0.1rem 0;
          font-size: 0.68rem;
          opacity: 0.5;
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
}
