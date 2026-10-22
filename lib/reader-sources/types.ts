/**
 * Unified reader — source model.
 * Feature: unified-reader
 *
 * One descriptor for "a thing you're reading," regardless of where it comes
 * from. The reader renders whatever produces a normalized {sentences, …}
 * payload; each source type just knows how to load itself. EPUB keeps its own
 * (epub.js) pipeline and is special-cased by the reader; articles and PDFs load
 * through the lighter text path.
 */

import type { Chapter } from '@/lib/types/reader';

export type ReadingSourceType = 'epub' | 'wikipedia' | 'sep' | 'iep' | 'pdf';

/** A library entry — something you're reading, from any source. */
export interface UnifiedSource {
  /** Stable id (sanitized title / filename), matches the read-along docId. */
  id: string;
  type: ReadingSourceType;
  title: string;
  /**
   * Source-specific locator: epub file url, article title (re-fetchable),
   * or pdf filename. The reader uses this to (re)load content on open.
   */
  ref: string;
  /** Epoch ms of last access, for Library ordering. */
  lastAccessed: number;
}

/** Normalized content the reader renders, regardless of source. */
export interface LoadedContent {
  title: string;
  sentences: string[];
  /** Chapters for paginated sources (EPUB); a single chapter for articles/PDF. */
  chapters: Chapter[];
  paragraphBreaks: Set<number>;
  headingIndices: Set<number>;
  listItemIndices: Set<number>;
}
