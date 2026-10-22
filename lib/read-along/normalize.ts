/**
 * Read-along alignment engine — transcript/text normalizer.
 * Feature: read-along-alignment (Phase 1)
 *
 * Both the document sentences and the incoming STT transcript pass through
 * the same normalizer, so "2%" in the document matches a reader saying
 * "two percent", and punctuation/casing differences never matter.
 *
 * Rules:
 * - lowercase
 * - strip punctuation (apostrophes removed in place: "don't" → "dont")
 * - collapse whitespace
 * - expand common symbols: $ → dollars (suffix), % → percent, & → and, + → plus
 * - expand numbers to words: 0-999 per 3-digit group, with magnitude words
 *   (thousand/million/billion); decimals as "three point five"
 */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen',
];

const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety',
];

const MAGNITUDES = ['', 'thousand', 'million', 'billion'];

/** 1..999 → words (caller handles 0). */
function threeDigitsToWords(n: number): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) {
    words.push(ONES[hundreds], 'hundred');
  }
  if (rest > 0) {
    if (rest < 20) {
      words.push(ONES[rest]);
    } else {
      words.push(TENS[Math.floor(rest / 10)]);
      if (rest % 10 > 0) words.push(ONES[rest % 10]);
    }
  }
  return words;
}

function integerToWords(digits: string): string[] {
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) return [digits];
  if (n === 0) return ['zero'];

  // Split into 3-digit groups, least significant first.
  const groups: number[] = [];
  let rem = n;
  while (rem > 0) {
    groups.push(rem % 1000);
    rem = Math.floor(rem / 1000);
  }
  if (groups.length > MAGNITUDES.length) return [digits]; // too big — keep raw

  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    words.push(...threeDigitsToWords(groups[i]));
    if (MAGNITUDES[i]) words.push(MAGNITUDES[i]);
  }
  return words;
}

/** Expand a single token if it's numeric; otherwise return it unchanged. */
function expandToken(token: string): string[] {
  if (/^\d+$/.test(token)) return integerToWords(token);
  const dec = token.match(/^(\d+)\.(\d+)$/);
  if (dec) {
    return [
      ...integerToWords(dec[1]),
      'point',
      ...dec[2].split('').map((d) => ONES[Number(d)]),
    ];
  }
  return [token];
}

export function normalize(text: string): string[] {
  let s = text.toLowerCase();
  s = s.replace(/(\d),(?=\d)/g, '$1'); // 1,000 → 1000
  s = s.replace(/\$\s*(\d+(?:\.\d+)?)/g, '$1 dollars'); // $100 → 100 dollars
  s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent'); // 2% → 2 percent
  s = s.replace(/&/g, ' and '); // AT&T → at and t
  s = s.replace(/\+/g, ' plus ');
  s = s.replace(/[’']/g, ''); // don't → dont
  // Strip punctuation, but keep dots that sit between two digits ("3.5").
  s = s.replace(/[^a-z0-9.\s]/g, ' ');
  s = s.replace(/\.(?!\d)/g, ' '); // dot not followed by a digit → gone
  s = s.replace(/(?<!\d)\./g, ' '); // dot not preceded by a digit → gone

  return s.split(/\s+/).filter(Boolean).flatMap(expandToken);
}
