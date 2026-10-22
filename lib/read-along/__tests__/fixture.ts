/**
 * Shared test fixture for the read-along matcher tests.
 * Feature: read-along-alignment (Phase 1)
 *
 * ~10 sentences of plain banking prose (~125 words). Vocabulary is kept
 * distinct between adjacent sentences so alignment behaviour is unambiguous,
 * and none of the question-utterance words used in the tests ("wait", "what",
 * "does", "this", "mean", ...) appear near the sentence starts they are
 * injected against.
 */

export const FIXTURE_SENTENCES = [
  'The central bank raised interest rates by 2% last quarter to fight stubborn inflation.',
  'Commercial lenders followed within days, repricing mortgages and business loans across the country.',
  'Savers finally saw meaningful returns on their deposit accounts after a decade of nothing.',
  'Credit card balances, however, became far more expensive for households to carry.',
  'Regional banks struggled as nervous depositors moved cash into money market funds.',
  'Regulators watched liquidity ratios closely throughout the turbulent spring season.',
  'Several smaller institutions tightened lending standards for construction and commercial projects.',
  'Bond portfolios lost considerable value as yields climbed across every maturity.',
  'Analysts debated whether the tightening cycle had finally reached its peak.',
  'Most economists expected rates to hold steady until inflation cooled toward the official target.',
];

/** All raw words of the document, in reading order. */
export const FIXTURE_WORDS = FIXTURE_SENTENCES.flatMap((s) => s.split(' '));
