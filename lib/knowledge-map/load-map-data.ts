/**
 * Knowledge Map — reading-data loader.
 * Feature: knowledge-map
 *
 * Bridges the persisted reading stores (article library in IndexedDB + per-doc
 * annotations) into the pure `buildKnowledgeMap` inputs. Client-only.
 */

import { readArticleLibrary } from '../reader-sources/library';
import { loadAnnotations } from '../reader-workspace/annotation-store';
import type { ArticleInput } from './build-map';

/**
 * Gather every saved article and the link-annotations captured inside it.
 * Articles with no annotations are still included (empty territories) so the
 * constellation reflects everything you've opened, not only what you linked.
 */
export async function loadMapInputs(): Promise<ArticleInput[]> {
  const library = await readArticleLibrary();
  const inputs = await Promise.all(
    library.map(async (entry) => ({
      id: entry.id,
      title: entry.title,
      type: entry.type,
      url: entry.url,
      annotations: await loadAnnotations(entry.id),
    })),
  );
  return inputs;
}
