/**
 * Reader Workspace — word-by-word highlight state derivation.
 * Feature: reader-workspace (Req 12)
 *
 * Projects the matcher's in-sentence token position onto the *rendered* words
 * of the current pointer sentence, so the UI can highlight word-by-word.
 *
 * The matcher works on NORMALIZED tokens (lowercased, punctuation stripped,
 * numbers→words), which do not generally line up 1:1 with the rendered words
 * the reader sees. We map positionally (rendered word k ≈ token k) and, when
 * the counts diverge beyond a small tolerance (or the position is invalid),
 * return null so the caller falls back to whole-sentence highlighting rather
 * than mis-highlighting individual words (Req 12.4). Pure + DOM-free.
 */

export type WordState = 'read' | 'current' | 'unread';

/** Default allowed divergence between rendered-word and normalized-token counts. */
const DEFAULT_TOLERANCE = 1;

/**
 * Derive the per-rendered-word state array for the current pointer sentence.
 *
 * @param renderedWords  the sentence split on whitespace (what the reader sees)
 * @param tokenCount     the matcher's normalized token count for the sentence
 * @param pos            the matcher's in-sentence position (window[0].pos):
 *                       tokens [0, pos) are matched, token `pos` is next
 * @param tolerance      max allowed |renderedWords.length - tokenCount| before
 *                       falling back (default 1)
 * @returns a WordState per rendered word, or null to signal whole-sentence
 *          fallback (Req 12.4)
 *
 * Rules (when non-null):
 *  - words at index `< pos` → 'read'
 *  - word at index `pos` → 'current' (only when pos is within the word range)
 *  - words at index `> pos` → 'unread'
 *  - when `pos >= renderedWords.length`, every word is 'read' (no 'current')
 * The result always has exactly one entry per rendered word (total partition).
 */
export function deriveWordStates(
  renderedWords: string[],
  tokenCount: number,
  pos: number,
  tolerance: number = DEFAULT_TOLERANCE,
): WordState[] | null {
  // Invalid position → fall back.
  if (!Number.isInteger(pos) || pos < 0) return null;

  const wordCount = renderedWords.length;
  if (wordCount === 0) return null;

  // Count divergence beyond tolerance → positional mapping is unreliable.
  if (Math.abs(wordCount - tokenCount) > tolerance) return null;

  const states: WordState[] = new Array(wordCount);
  for (let i = 0; i < wordCount; i++) {
    if (i < pos) states[i] = 'read';
    else if (i === pos) states[i] = 'current';
    else states[i] = 'unread';
  }
  return states;
}
