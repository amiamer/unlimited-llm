/**
 * Unified reader — article source loader.
 * Feature: unified-reader
 *
 * Fetches an HTML article (Wikipedia, SEP) and normalizes it into the same
 * `LoadedContent` shape the EPUB path produces, so the unified reader can open
 * an article exactly like it opens a book — one rendering path, many sources.
 */

import { extractArticleSentences } from './extract-article';
import type { LoadedContent } from './types';
import type { Chapter } from '@/lib/types/reader';

export interface LoadArticleOptions {
  /** Search/fetch endpoint, e.g. '/api/wikipedia/search' or '/api/sep/search'. */
  apiEndpoint: string;
  /** Article title or search term. */
  query: string;
  /** Source-specific boilerplate selectors to strip (in addition to defaults). */
  unwantedSelectors?: string[];
}

interface ArticleApiResponse {
  title: string;
  content: string;
  url?: string;
}

/**
 * Normalize already-fetched article HTML into reader content (no network).
 * Used when opening a Library entry whose HTML is already cached locally.
 */
export function loadArticleFromContent(opts: {
  title: string;
  html: string;
  unwantedSelectors?: string[];
}): LoadedContent {
  const extracted = extractArticleSentences(opts.html, opts.unwantedSelectors ?? []);

  // Articles are single-chapter; the reader's chapter machinery still applies.
  const chapters: Chapter[] =
    extracted.sentences.length > 0
      ? [
          {
            index: 0,
            title: opts.title,
            href: '',
            sentences: extracted.sentences,
            paragraphs: [{ sentences: extracted.sentences }],
          },
        ]
      : [];

  return {
    title: opts.title,
    sentences: extracted.sentences,
    chapters,
    paragraphBreaks: extracted.paragraphBreaks,
    headingIndices: extracted.headingIndices,
    listItemIndices: extracted.listItemIndices,
  };
}

/**
 * Load an article source into normalized reader content. Throws on a failed
 * fetch so the caller can surface an Error State.
 */
export async function loadArticleSource(opts: LoadArticleOptions): Promise<LoadedContent> {
  const res = await fetch(`${opts.apiEndpoint}?q=${encodeURIComponent(opts.query)}`);
  if (!res.ok) throw new Error(`Failed to fetch article (HTTP ${res.status})`);
  const data = (await res.json()) as ArticleApiResponse;
  return loadArticleFromContent({
    title: data.title,
    html: data.content,
    unwantedSelectors: opts.unwantedSelectors,
  });
}
