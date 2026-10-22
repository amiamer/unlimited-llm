import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { applyTrackerOperation, loadTracker } from '../store';

const USER = 'user_1';
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'habit-tracker-'));
  process.env.HABIT_TRACKER_FILE = path.join(dir, 'habit-tracker.json');
});

afterEach(async () => {
  delete process.env.HABIT_TRACKER_FILE;
  await rm(dir, { recursive: true, force: true });
});

const create = (name: string, monthlyGoal = 20, year = 2026, month = 9) =>
  applyTrackerOperation(USER, { type: 'createHabit', year, month, name, monthlyGoal });

describe('habit tracker JSON store', () => {
  it('starts empty, on the fallback month, unconfigured', async () => {
    const snapshot = await loadTracker(USER, 2026, 9);
    expect(snapshot).toEqual({
      selectedYear: 2026,
      selectedMonth: 9,
      month: { year: 2026, month: 9, configured: false, habits: [] },
    });
  });

  it('creates habits in order and persists them to the file', async () => {
    await create('read');
    const snapshot = await create('lift', 12);
    expect(snapshot.month.configured).toBe(true);
    expect(snapshot.month.habits.map((h) => [h.name, h.order, h.monthlyGoal])).toEqual([
      ['read', 0, 20],
      ['lift', 1, 12],
    ]);
    const saved = JSON.parse(await readFile(process.env.HABIT_TRACKER_FILE!, 'utf-8'));
    expect(saved.users[USER].months['2026-09'].habits).toHaveLength(2);
  });

  it('adds and removes completions and rejects dates outside the month', async () => {
    const { month } = await create('read');
    const habitId = month.habits[0].id;
    const base = { type: 'setCompletion', year: 2026, month: 9, habitId } as const;
    await applyTrackerOperation(USER, { ...base, date: '2026-09-03', completed: true });
    let snapshot = await applyTrackerOperation(USER, { ...base, date: '2026-09-01', completed: true });
    expect(snapshot.month.habits[0].completions).toEqual(['2026-09-01', '2026-09-03']);
    snapshot = await applyTrackerOperation(USER, { ...base, date: '2026-09-03', completed: false });
    expect(snapshot.month.habits[0].completions).toEqual(['2026-09-01']);
    await expect(
      applyTrackerOperation(USER, { ...base, date: '2026-10-01', completed: true }),
    ).rejects.toThrow('Date does not belong to the selected month.');
  });

  it('renames, re-goals, reorders and removes', async () => {
    await create('a');
    await create('b');
    const { month } = await create('c');
    const [a, , c] = month.habits;
    const ym = { year: 2026, month: 9 };
    await applyTrackerOperation(USER, { type: 'renameHabit', ...ym, habitId: a.id, name: 'alpha' });
    await applyTrackerOperation(USER, { type: 'setGoal', ...ym, habitId: a.id, monthlyGoal: 5 });
    let snapshot = await applyTrackerOperation(USER, { type: 'reorderHabit', ...ym, habitId: c.id, direction: 'up' });
    expect(snapshot.month.habits.map((h) => h.name)).toEqual(['alpha', 'c', 'b']);
    expect(snapshot.month.habits[0].monthlyGoal).toBe(5);
    snapshot = await applyTrackerOperation(USER, { type: 'removeHabit', ...ym, habitId: a.id });
    expect(snapshot.month.habits.map((h) => h.name)).toEqual(['c', 'b']);
    await expect(
      applyTrackerOperation(USER, { type: 'removeHabit', ...ym, habitId: 'missing' }),
    ).rejects.toThrow('Habit not found.');
  });

  it('starts a new month with the previous month habits, goals capped, no completions', async () => {
    const { month } = await create('daily', 31, 2026, 8);
    await applyTrackerOperation(USER, {
      type: 'setCompletion', year: 2026, month: 8, habitId: month.habits[0].id, date: '2026-08-02', completed: true,
    });
    const snapshot = await applyTrackerOperation(USER, { type: 'selectMonth', year: 2026, month: 9 });
    expect(snapshot.selectedMonth).toBe(9);
    expect(snapshot.month.configured).toBe(true);
    expect(snapshot.month.habits).toHaveLength(1);
    expect(snapshot.month.habits[0]).toMatchObject({ name: 'daily', monthlyGoal: 30, completions: [] });
    expect(snapshot.month.habits[0].id).not.toBe(month.habits[0].id);
    expect((await loadTracker(USER, 2000, 1)).selectedMonth).toBe(9);
  });

  it('keeps every write when operations arrive at once', async () => {
    const { month } = await create('read');
    const habitId = month.habits[0].id;
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        applyTrackerOperation(USER, {
          type: 'setCompletion', year: 2026, month: 9, habitId,
          date: `2026-09-${String(i + 1).padStart(2, '0')}`, completed: true,
        }),
      ),
    );
    const snapshot = await loadTracker(USER, 2026, 9);
    expect(snapshot.month.habits[0].completions).toHaveLength(10);
  });
});
