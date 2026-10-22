/**
 * Reader Workspace — selection → sentence-index anchor derivation.
 * Feature: reader-workspace
 *
 * Anchoring is **sentence-granular**: an annotation always spans whole
 * sentences. A selection that covers only part of a sentence anchors to the
 * entire sentence(s) it intersects, because the anchor is derived solely from
 * the `data-sentence-index` values of the touched spans (Requirement 2.6).
 * Sub-sentence and character-level offsets are deliberately discarded.
 *
 * `buildAnchor` is the pure core (no DOM) and carries the property tests;
 * `deriveAnchor` is the thin DOM adapter that reads `data-sentence-index`.
 */

import type { SelectionAnchor } from './types';

/**
 * Pure core: given the sentence indices a selection touches and the selected
 * text, build a sentence-granular anchor.
 *
 * Returns null when no sentence is touched (empty/collapsed selection), so the
 * caller creates no annotation (Requirements 2.7, 3.3). Otherwise the anchor
 * spans [min, max] of the touched indices — always whole sentences (Req 2.6).
 * Negative indices are ignored as invalid.
 */
export function buildAnchor(
  touchedIndices: number[],
  selectedText: string,
): SelectionAnchor | null {
  const valid = touchedIndices.filter(
    (i) => Number.isInteger(i) && i >= 0,
  );
  if (valid.length === 0) return null;

  let min = valid[0];
  let max = valid[0];
  for (const i of valid) {
    if (i < min) min = i;
    if (i > max) max = i;
  }

  return {
    startSentenceIndex: min,
    endSentenceIndex: max,
    selectedText,
  };
}

/**
 * True only when the anchor is well-formed and fully within the document:
 * `0 <= start <= end < sentenceCount`. Used to drop stale annotations whose
 * indices fall outside the current document (Requirement 7.4).
 */
export function isAnchorWithinDoc(
  a: SelectionAnchor,
  sentenceCount: number,
): boolean {
  return (
    Number.isInteger(a.startSentenceIndex) &&
    Number.isInteger(a.endSentenceIndex) &&
    a.startSentenceIndex >= 0 &&
    a.startSentenceIndex <= a.endSentenceIndex &&
    a.endSentenceIndex < sentenceCount
  );
}

/**
 * Collect the `data-sentence-index` values of the sentence spans a DOM Range
 * intersects, within `container`. Returns the sorted unique indices.
 *
 * A span counts as touched when the range intersects it. We test every
 * `[data-sentence-index]` element in the container with
 * `range.intersectsNode`, falling back to a manual range-overlap check where
 * `intersectsNode` is unavailable (older/jsdom environments).
 */
function collectTouchedIndices(range: Range, container: HTMLElement): number[] {
  const spans = container.querySelectorAll<HTMLElement>('[data-sentence-index]');
  const touched: number[] = [];

  spans.forEach((span) => {
    const raw = span.getAttribute('data-sentence-index');
    if (raw === null) return;
    const idx = Number.parseInt(raw, 10);
    if (!Number.isInteger(idx) || idx < 0) return;

    let intersects = false;
    if (typeof range.intersectsNode === 'function') {
      intersects = range.intersectsNode(span);
    } else {
      // Fallback: compare against a range spanning the whole span.
      const spanRange = span.ownerDocument.createRange();
      spanRange.selectNodeContents(span);
      intersects =
        range.compareBoundaryPoints(Range.END_TO_START, spanRange) < 0 &&
        range.compareBoundaryPoints(Range.START_TO_END, spanRange) > 0;
    }
    if (intersects) touched.push(idx);
  });

  return touched;
}

/**
 * Derive a sentence-granular annotation anchor from a DOM Range.
 *
 * Returns null when the range is collapsed (a caret) or touches no sentence
 * span (Requirement 2.7). Otherwise delegates to `buildAnchor` over the
 * touched `data-sentence-index` values (Requirement 2.5/2.6).
 */
export function deriveAnchor(
  range: Range,
  container: HTMLElement,
): SelectionAnchor | null {
  if (range.collapsed) return null;
  const selectedText = range.toString().trim();
  if (selectedText.length === 0) return null;

  const touched = collectTouchedIndices(range, container);
  return buildAnchor(touched, selectedText);
}
