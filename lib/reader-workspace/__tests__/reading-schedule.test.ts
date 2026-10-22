import { describe, it, expect } from 'vitest';
import {
  findSchedule,
  resolveSchedule,
  currentScheduleItem,
  parseSchedules,
  type BookSchedule,
} from '../reading-schedule';
import type { Chapter } from '@/lib/types/reader';

/** Build a minimal chapter list from titles (only `title` matters here). */
function chaptersFromTitles(titles: string[]): Chapter[] {
  return titles.map((title, index) => ({
    index,
    title,
    href: `s${index}.html`,
    sentences: ['x'],
    paragraphs: [{ sentences: ['x'] }],
  }));
}

// A long novel's chapter ordering as the reader extracts it, with the
// structural Volume/Part dividers preserved.
const NOVEL_TITLES = [
  'Introduction',            // 0
  'PRINCIPAL CHARACTERS',    // 1
  'Volume I',                // 2
  'Part One',                // 3  (Vol 1 P1 starts)
  'Part Two',                // 4  (Vol 1 P2 starts)
  'Part Three',              // 5  (Vol 1 P3 starts)
  'Volume II',               // 6
  'Part One',                // 7  (Vol 2 P1)
  'Part Two',                // 8  (Vol 2 P2)
  'Part Three',              // 9  (Vol 2 P3)
  'Part Four',               // 10 (Vol 2 P4)
  'Part Five',               // 11 (Vol 2 P5)
  'Volume III',              // 12
  'Part One',                // 13 (Vol 3 P1)
  'Part Two',                // 14 (Vol 3 P2)
  'Part Three',              // 15 (Vol 3 P3)
  'Volume IV',               // 16
  'Part One',                // 17 (Vol 4 P1)
  'Part Two',                // 18
  'Part Three',              // 19
  'Part Four',               // 20
  'Epilogue',                // 21
  'Part One',                // 22
  'Part Two',                // 23
  'Notes',                   // 24 (back-matter — should be skipped for "end")
];

// A weekly schedule as it would be stored in the vault's reading-schedules.json.
const NOVEL: BookSchedule = {
  title: 'The Long Novel',
  match: ['long', 'novel'],
  items: [
    { date: '9/27', pages: 'pp. 3-111', label: 'Vol. 1, Part 1', endsBefore: { volume: 1, part: 2 } },
    { date: '10/4', pages: 'pp. 112-200', label: 'Vol. 1, Part 2', endsBefore: { volume: 1, part: 3 } },
    { date: '10/11', pages: 'pp. 201-294', label: 'Vol. 1, Part 3', endsBefore: { volume: 2, part: 1 } },
    { date: '10/18', pages: 'pp. 297-417', label: 'Vol. 2, Parts 1 & 2', endsBefore: { volume: 2, part: 3 } },
    { date: '10/25', pages: 'pp. 418-534', label: 'Vol. 2, Parts 3 & 4', endsBefore: { volume: 2, part: 5 } },
    { date: '11/1', pages: 'pp. 535-681', label: 'Vol. 2, Part 5 – Vol. 3, Part 1', endsBefore: { volume: 3, part: 2 } },
    { date: '11/8', pages: 'pp. 682-820', label: 'Vol. 3, Part 2', endsBefore: { volume: 3, part: 3 } },
    { date: '11/15', pages: 'pp. 821-932', label: 'Vol. 3, Part 3', endsBefore: { volume: 4, part: 1 } },
    { date: '11/22', pages: 'pp. 935-1074', label: 'Vol. 4, Parts 1-3', endsBefore: { volume: 4, part: 4 } },
    { date: '12/6', pages: 'pp. 1075-1215', label: 'Vol. 4, Part 4 – Epilogue', endsBefore: null },
  ],
};
const SCHEDULES = [NOVEL];

describe('reading-schedule', () => {
  it('matches a schedule by title tokens', () => {
    expect(findSchedule('The Long Novel (Unabridged)', SCHEDULES)).not.toBeNull();
    expect(findSchedule('Short Stories', SCHEDULES)).toBeNull();
    expect(findSchedule('The Long Novel', [])).toBeNull();
  });

  it('resolves each deadline to the correct ending boundary', () => {
    const chapters = chaptersFromTitles(NOVEL_TITLES);
    const resolved = resolveSchedule('The Long Novel', chapters, SCHEDULES);
    expect(resolved).not.toBeNull();
    const items = resolved!.items;

    // 9/27: end of Vol 1 Part 1 → stop just before Vol 1 Part 2 (index 4) => 3.
    expect(items[0].boundaryChapterIndex).toBe(3);
    // 10/11: end of Vol 1 → stop just before Vol 2 Part 1 (index 7) => 6 ("Volume II").
    expect(items[2].boundaryChapterIndex).toBe(6);
    // 10/18: Vol 2 Parts 1&2 → stop before Vol 2 Part 3 (index 9) => 8.
    expect(items[3].boundaryChapterIndex).toBe(8);
    // 11/15: Vol 3 Part 3 → stop before Vol 4 Part 1 (index 17) => 16 ("Volume IV").
    expect(items[7].boundaryChapterIndex).toBe(16);
    // 12/6: to the end → last CONTENT chapter, skipping "Notes" (24) => 23.
    expect(items[9].boundaryChapterIndex).toBe(23);
    expect(items[9].boundaryTitle).toBe('Part Two');
  });

  it('computes each week start as the beginning of that week\'s reading', () => {
    const chapters = chaptersFromTitles(NOVEL_TITLES);
    const { items } = resolveSchedule('The Long Novel', chapters, SCHEDULES)!;

    // First week starts at the first mapped PART boundary — "Part One" (index
    // 3), the real start of the body (the "Volume I" divider at 2 is just a
    // section header, not a part).
    expect(items[0].startChapterIndex).toBe(3);
    // Second week starts right after the first week's end (3) => 4 ("Part Two").
    expect(items[1].startChapterIndex).toBe(4);
    // Third week starts after Vol 1 Part 2's end (4) => 5 ("Part Three").
    expect(items[2].startChapterIndex).toBe(5);
    // Week after the one ending at "Volume II" (6) starts at 7 (Vol 2 Part 1).
    expect(items[3].startChapterIndex).toBe(7);
  });

  it('tracks which deadline the reader is currently working toward', () => {
    const chapters = chaptersFromTitles(NOVEL_TITLES);
    const { items } = resolveSchedule('The Long Novel', chapters, SCHEDULES)!;

    // At the very start (chapter 0), working toward the first deadline.
    expect(currentScheduleItem(items, 0)).toBe(0);
    // At chapter 4 (Vol 1 Part 2), the first deadline (boundary 3) is done, so
    // we're on the second (boundary 4).
    expect(currentScheduleItem(items, 4)).toBe(1);
    // Past the last boundary → items.length.
    expect(currentScheduleItem(items, 24)).toBe(items.length);
  });

  it('returns null for an unmatched book or empty chapters', () => {
    expect(resolveSchedule('Some Other Book', chaptersFromTitles(['A', 'B']), SCHEDULES)).toBeNull();
    expect(resolveSchedule('The Long Novel', [], SCHEDULES)).toBeNull();
  });

  it('parses schedules from the vault file and drops malformed entries', () => {
    const parsed = parseSchedules({
      schedules: [
        { ...NOVEL, match: ['LONG', 'Novel'] },
        { title: 'No items', match: ['x'], items: [] },
        { title: 'Bad boundary', match: ['bad'], items: [{ date: '1/1', label: 'x', endsBefore: { volume: 0, part: 1 } }] },
        'not an object',
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].match).toEqual(['long', 'novel']);
    expect(parsed[0].items).toHaveLength(10);
    expect(parsed[0].items[9].endsBefore).toBeNull();
    expect(parseSchedules([NOVEL])).toHaveLength(1);
    expect(parseSchedules(null)).toEqual([]);
    expect(parseSchedules({ schedules: 'nope' })).toEqual([]);
  });
});
