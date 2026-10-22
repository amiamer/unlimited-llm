import 'server-only';

import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { atomicWrite } from '@/lib/local-storage/file-utils';
import { daysInMonth, type Habit, type MonthTracker, type TrackerSnapshot } from './model';

/**
 * Habit tracker storage: one JSON file in the Obsidian vault, so the data syncs
 * with the vault (git) and needs no database.
 *
 * Location: HABIT_TRACKER_FILE, else <OBSIDIAN_VAULT_PATH>/excluded/habit-tracker.json.
 */

interface StoredHabit {
  id: string;
  name: string;
  monthlyGoal: number;
  order: number;
  completions: string[];
}

interface StoredUser {
  selectedYear: number;
  selectedMonth: number;
  /** Keyed "YYYY-MM". A month exists once it has been configured. */
  months: Record<string, { habits: StoredHabit[] }>;
}

interface StoredTracker {
  version: 1;
  users: Record<string, StoredUser>;
}

export type TrackerOperation =
  | { type: 'selectMonth'; year: number; month: number }
  | { type: 'createHabit'; year: number; month: number; name: string; monthlyGoal: number }
  | { type: 'renameHabit'; year: number; month: number; habitId: string; name: string }
  | { type: 'setGoal'; year: number; month: number; habitId: string; monthlyGoal: number }
  | { type: 'reorderHabit'; year: number; month: number; habitId: string; direction: 'up' | 'down' }
  | { type: 'removeHabit'; year: number; month: number; habitId: string }
  | { type: 'setCompletion'; year: number; month: number; habitId: string; date: string; completed: boolean };

export function trackerFilePath(): string {
  if (process.env.HABIT_TRACKER_FILE) return process.env.HABIT_TRACKER_FILE;
  const vault = process.env.OBSIDIAN_VAULT_PATH;
  if (!vault) throw new Error('OBSIDIAN_VAULT_PATH is not configured.');
  return path.join(vault, 'excluded', 'habit-tracker.json');
}

async function readTracker(): Promise<StoredTracker> {
  try {
    const parsed = JSON.parse(await readFile(trackerFilePath(), 'utf-8')) as StoredTracker;
    return { version: 1, users: parsed.users ?? {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, users: {} };
    throw error;
  }
}

async function writeTracker(tracker: StoredTracker): Promise<void> {
  await atomicWrite(trackerFilePath(), `${JSON.stringify(tracker, null, 2)}\n`);
}

// Every read-modify-write goes through one queue so concurrent requests can't
// overwrite each other's changes.
let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
const monthIndex = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + m;
};

function getUser(tracker: StoredTracker, userId: string, year: number, month: number): StoredUser {
  tracker.users[userId] ??= { selectedYear: year, selectedMonth: month, months: {} };
  return tracker.users[userId];
}

/** A new month starts with the latest earlier month's habits (goals capped, no completions). */
function ensureMonth(user: StoredUser, year: number, month: number): void {
  const key = monthKey(year, month);
  if (user.months[key]) return;
  const previousKey = Object.keys(user.months)
    .filter((k) => monthIndex(k) < monthIndex(key))
    .sort((a, b) => monthIndex(b) - monthIndex(a))[0];
  if (!previousKey) return;
  user.months[key] = {
    habits: [...user.months[previousKey].habits]
      .sort((a, b) => a.order - b.order)
      .map((habit) => ({
        id: randomUUID(),
        name: habit.name,
        monthlyGoal: Math.min(habit.monthlyGoal, daysInMonth(year, month)),
        order: habit.order,
        completions: [],
      })),
  };
}

function getOrCreateMonth(user: StoredUser, year: number, month: number): { habits: StoredHabit[] } {
  ensureMonth(user, year, month);
  const key = monthKey(year, month);
  user.months[key] ??= { habits: [] };
  return user.months[key];
}

function loadMonth(user: StoredUser, year: number, month: number): MonthTracker {
  const stored = user.months[monthKey(year, month)];
  if (!stored) return { year, month, configured: false, habits: [] };
  const habits: Habit[] = [...stored.habits]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((habit) => ({ ...habit, completions: [...habit.completions].sort() }));
  return { year, month, configured: true, habits };
}

function dateBelongsToMonth(value: string, year: number, month: number): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const day = Number(match[3]);
  return Number(match[1]) === year
    && Number(match[2]) === month
    && day >= 1
    && day <= daysInMonth(year, month);
}

export function loadTracker(
  userId: string,
  fallbackYear: number,
  fallbackMonth: number,
): Promise<TrackerSnapshot> {
  return withLock(async () => {
    const tracker = await readTracker();
    const before = JSON.stringify(tracker);
    const user = getUser(tracker, userId, fallbackYear, fallbackMonth);
    const year = user.selectedYear;
    const month = user.selectedMonth;
    ensureMonth(user, year, month);
    if (JSON.stringify(tracker) !== before) await writeTracker(tracker);
    return { selectedYear: year, selectedMonth: month, month: loadMonth(user, year, month) };
  });
}

export function applyTrackerOperation(
  userId: string,
  operation: TrackerOperation,
): Promise<TrackerSnapshot> {
  return withLock(async () => {
    const tracker = await readTracker();
    const { year, month } = operation;
    const user = getUser(tracker, userId, year, month);

    if (operation.type === 'selectMonth') {
      user.selectedYear = year;
      user.selectedMonth = month;
      ensureMonth(user, year, month);
    } else {
      const stored = getOrCreateMonth(user, year, month);
      if (operation.type === 'createHabit') {
        const order = stored.habits.reduce((max, habit) => Math.max(max, habit.order), -1) + 1;
        stored.habits.push({
          id: randomUUID(),
          name: operation.name,
          monthlyGoal: operation.monthlyGoal,
          order,
          completions: [],
        });
      } else {
        const habit = stored.habits.find((candidate) => candidate.id === operation.habitId);
        if (!habit) throw new Error('Habit not found.');
        if (operation.type === 'renameHabit') {
          habit.name = operation.name;
        } else if (operation.type === 'setGoal') {
          habit.monthlyGoal = operation.monthlyGoal;
        } else if (operation.type === 'removeHabit') {
          stored.habits = stored.habits.filter((candidate) => candidate.id !== habit.id);
        } else if (operation.type === 'reorderHabit') {
          const up = operation.direction === 'up';
          const neighbor = stored.habits
            .filter((candidate) => (up ? candidate.order < habit.order : candidate.order > habit.order))
            .sort((a, b) => (up ? b.order - a.order : a.order - b.order))[0];
          if (neighbor) [habit.order, neighbor.order] = [neighbor.order, habit.order];
        } else if (operation.type === 'setCompletion') {
          if (!dateBelongsToMonth(operation.date, year, month)) {
            throw new Error('Date does not belong to the selected month.');
          }
          const others = habit.completions.filter((date) => date !== operation.date);
          habit.completions = operation.completed ? [...others, operation.date].sort() : others;
        }
      }
    }

    await writeTracker(tracker);
    return { selectedYear: year, selectedMonth: month, month: loadMonth(user, year, month) };
  });
}
