/**
 * Reading schedule support for the reader.
 *
 * A reading group reads a long book against a calendar of deadlines, but an
 * EPUB has no page numbers (it reflows), so a "pp. 3-111" schedule can't be
 * pinned to pages. Instead we pin each deadline to a structural boundary —
 * a Volume/Part start — which the book's own table of contents exposes and
 * which every real-world schedule lines up with.
 *
 * The schedules themselves are user data, not code: they live in the user's
 * vault (served by /api/reading-schedules) and are passed in here.
 *  - findSchedule() picks the schedule whose match tokens fit the book title.
 *  - resolveSchedule() turns its deadlines into concrete chapter indices by
 *    matching (Volume, Part) boundaries against the extracted chapter titles.
 *
 * If the book isn't recognized, resolveSchedule returns null and the UI hides
 * the schedule panel — so this never interferes with other books.
 */

import type { Chapter } from '@/lib/types/reader';

/** A boundary target: the (volume, part) whose START marks a point in the book. */
export interface BoundaryTarget {
  /** 1-based volume number; use 'epilogue' for the epilogue. */
  volume: number | 'epilogue';
  /** 1-based part number within the volume/epilogue. */
  part: number;
}

/** One deadline in a reading schedule. */
export interface ScheduleItem {
  /** Human date label, e.g. "9/27". */
  date: string;
  /** Optional page range for reference, shown as a subtitle. */
  pages?: string;
  /** Human description of what's due, e.g. "Vol. 1, Part 1". */
  label: string;
  /**
   * The boundary that marks the END of this week's reading: the START of the
   * NEXT section to read. null means "to the end of the book".
   */
  endsBefore: BoundaryTarget | null;
}

/** A named schedule for a specific book. */
export interface BookSchedule {
  /** Lowercased substrings; if the book title contains all, it matches. */
  match: string[];
  title: string;
  items: ScheduleItem[];
}

/** Find a schedule whose match tokens all appear in the (lowercased) title. */
export function findSchedule(bookTitle: string, schedules: readonly BookSchedule[]): BookSchedule | null {
  const t = (bookTitle || '').toLowerCase();
  return schedules.find((s) => s.match.length > 0 && s.match.every((m) => t.includes(m))) ?? null;
}

function parseBoundary(raw: unknown): BoundaryTarget | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return undefined;
  const { volume, part } = raw as Record<string, unknown>;
  const validVolume = volume === 'epilogue' || (typeof volume === 'number' && Number.isInteger(volume) && volume > 0);
  if (!validVolume || typeof part !== 'number' || !Number.isInteger(part) || part < 1) return undefined;
  return { volume: volume as number | 'epilogue', part };
}

/**
 * Validate schedules loaded from disk (either `{ schedules: [...] }` or a bare
 * array). Malformed schedules or items are dropped rather than breaking the reader.
 */
export function parseSchedules(raw: unknown): BookSchedule[] {
  const list = Array.isArray(raw) ? raw : (raw as { schedules?: unknown } | null)?.schedules;
  if (!Array.isArray(list)) return [];
  const schedules: BookSchedule[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const { title, match, items } = entry as Record<string, unknown>;
    if (typeof title !== 'string' || !Array.isArray(match) || !Array.isArray(items)) continue;
    const tokens = match.filter((m): m is string => typeof m === 'string' && m.trim() !== '').map((m) => m.toLowerCase());
    const parsedItems: ScheduleItem[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const { date, label, pages, endsBefore } = item as Record<string, unknown>;
      const boundary = parseBoundary(endsBefore);
      if (typeof date !== 'string' || typeof label !== 'string' || boundary === undefined) continue;
      parsedItems.push({ date, label, endsBefore: boundary, ...(typeof pages === 'string' ? { pages } : {}) });
    }
    if (tokens.length > 0 && parsedItems.length > 0) schedules.push({ title, match: tokens, items: parsedItems });
  }
  return schedules;
}

/** Roman numeral → integer for volume/part titles like "II", "IV". */
function romanToInt(s: string): number | null {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  const up = s.trim().toUpperCase();
  if (!/^[IVXLC]+$/.test(up)) return null;
  let total = 0;
  for (let i = 0; i < up.length; i++) {
    const cur = map[up[i]];
    const next = map[up[i + 1]];
    total += next && cur < next ? -cur : cur;
  }
  return total || null;
}

/** Parse a part number from a title like "Part One", "Part 2", "Part II". */
const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
function parsePartNumber(title: string): number | null {
  const m = title.match(/\bpart\s+([a-z0-9]+)/i);
  if (!m) return null;
  const tok = m[1].toLowerCase();
  if (WORD_NUM[tok]) return WORD_NUM[tok];
  const asInt = parseInt(tok, 10);
  if (Number.isFinite(asInt)) return asInt;
  const roman = romanToInt(tok);
  return roman;
}

/** A resolved schedule item with the chapter indices it spans. */
export interface ResolvedScheduleItem extends ScheduleItem {
  /**
   * Chapter index where this week's reading STARTS (where the previous week
   * ended + 1, or the first reading chapter for the first week). Jumping to a
   * deadline navigates here.
   */
  startChapterIndex: number;
  /**
   * Chapter index where this week's reading ENDS (inclusive) — the last chapter
   * to read before the next section begins. For the final item this is the last
   * content chapter.
   */
  boundaryChapterIndex: number;
  /** The chapter title at the end boundary (for display / verification). */
  boundaryTitle: string;
}

/**
 * Walk the chapter list, tracking the current volume as we cross "Volume N"
 * markers, and record the chapter index where each (volume, part) STARTS.
 * Chapter titles come from the TOC ("Volume I", "Part One", "Epilogue", ...).
 */
function buildBoundaryMap(chapters: Chapter[]): Map<string, number> {
  const key = (vol: number | 'epilogue', part: number) => `${vol}:${part}`;
  const map = new Map<string, number>();
  let currentVolume: number | 'epilogue' = 1;
  let sawVolumeMarker = false;

  for (let i = 0; i < chapters.length; i++) {
    const title = (chapters[i].title || '').trim();

    // Volume boundary (e.g. "Volume I", "Volume II").
    const volMatch = title.match(/\bvolume\s+([ivxlc]+|\d+)/i);
    if (volMatch) {
      const tok = volMatch[1];
      const n = /^\d+$/.test(tok) ? parseInt(tok, 10) : romanToInt(tok);
      if (n) { currentVolume = n; sawVolumeMarker = true; }
      continue;
    }

    // Epilogue boundary.
    if (/\bepilogue\b/i.test(title)) {
      currentVolume = 'epilogue';
      sawVolumeMarker = true;
      // The epilogue's own parts follow; also record epilogue part 1 start here
      // if the title itself carries a part.
    }

    // Part boundary within the current volume/epilogue.
    const partNum = parsePartNumber(title);
    if (partNum != null) {
      const k = key(currentVolume, partNum);
      if (!map.has(k)) map.set(k, i);
    }
  }

  // If the book never exposed explicit "Volume" markers we can't map reliably;
  // callers treat an empty map as "unresolvable".
  if (!sawVolumeMarker && map.size === 0) return new Map();
  return map;
}

/**
 * Resolve a book schedule against the extracted chapters, producing per-item
 * chapter indices. Returns null when the book isn't recognized or its structure
 * can't be matched (so the UI can hide the panel).
 */
export function resolveSchedule(
  bookTitle: string,
  chapters: Chapter[],
  schedules: readonly BookSchedule[],
): { schedule: BookSchedule; items: ResolvedScheduleItem[] } | null {
  const schedule = findSchedule(bookTitle, schedules);
  if (!schedule || chapters.length === 0) return null;

  const boundaries = buildBoundaryMap(chapters);

  // For the "to the end" item, stop at the last real reading chapter — skip
  // trailing back-matter (notes/endnotes/appendix) so "finish the book" doesn't
  // point at the notes dump.
  let lastContentIndex = chapters.length - 1;
  while (
    lastContentIndex > 0 &&
    /\b(notes?|endnotes?|footnotes?|appendix|index|bibliograph)\b/i.test(
      chapters[lastContentIndex].title || '',
    )
  ) {
    lastContentIndex--;
  }

  // First reading chapter = the first mapped boundary (earliest Part/Volume
  // start), so the first week starts at the actual beginning of the book's body
  // rather than at front-matter.
  const firstReadingChapter =
    boundaries.size > 0 ? Math.min(...boundaries.values()) : 0;

  // Compute end boundaries first, then derive each week's START from the
  // previous week's end + 1.
  const ends: number[] = schedule.items.map((item) => {
    if (item.endsBefore === null) return lastContentIndex;
    const k = `${item.endsBefore.volume}:${item.endsBefore.part}`;
    const startOfNext = boundaries.get(k);
    return startOfNext != null ? Math.max(0, startOfNext - 1) : lastContentIndex;
  });

  const items: ResolvedScheduleItem[] = schedule.items.map((item, i) => {
    const boundaryChapterIndex = ends[i];
    const startChapterIndex =
      i === 0 ? firstReadingChapter : Math.min(ends[i - 1] + 1, lastContentIndex);
    return {
      ...item,
      startChapterIndex,
      boundaryChapterIndex,
      boundaryTitle: chapters[boundaryChapterIndex]?.title ?? '',
    };
  });

  return { schedule, items };
}

/**
 * Given the current chapter index, return the index of the schedule item the
 * reader is currently working toward (the first deadline whose boundary is at
 * or after the current chapter). Returns items.length when past the last one.
 */
export function currentScheduleItem(
  items: ResolvedScheduleItem[],
  currentChapter: number,
): number {
  for (let i = 0; i < items.length; i++) {
    if (currentChapter <= items[i].boundaryChapterIndex) return i;
  }
  return items.length;
}
