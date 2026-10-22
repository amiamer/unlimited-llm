import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/auth-utils';
import { applyTrackerOperation, loadTracker, type TrackerOperation } from '@/lib/habit-tracker/store';
import { validateHabitName, validateMonthlyGoal } from '@/lib/habit-tracker/model';

export const dynamic = 'force-dynamic';

function validYearMonth(year: number, month: number): boolean {
  return Number.isInteger(year) && year >= 1900 && year <= 2200
    && Number.isInteger(month) && month >= 1 && month <= 12;
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const authResult = await getAuthenticatedUserId();
  if ('error' in authResult) return authResult.error;

  const now = new Date();
  const year = Number(request.nextUrl.searchParams.get('year')) || now.getFullYear();
  const month = Number(request.nextUrl.searchParams.get('month')) || now.getMonth() + 1;
  if (!validYearMonth(year, month)) return errorResponse('Invalid month or year.');

  try {
    return NextResponse.json(await loadTracker(authResult.userId, year, month));
  } catch (error) {
    console.error('[Habit Tracker] Load failed:', error);
    return errorResponse('Habit tracker data could not be loaded.', 500);
  }
}

function parseOperation(value: unknown): TrackerOperation | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const { type, year, month } = input;
  if (typeof type !== 'string' || typeof year !== 'number' || typeof month !== 'number'
      || !validYearMonth(year, month)) return null;
  const base = { year, month };

  if (type === 'selectMonth') return { type, ...base };
  if (type === 'createHabit' && typeof input.name === 'string' && typeof input.monthlyGoal === 'number') {
    if (validateHabitName(input.name) || validateMonthlyGoal(input.monthlyGoal, year, month)) return null;
    return { type, ...base, name: input.name.trim(), monthlyGoal: input.monthlyGoal };
  }
  if (typeof input.habitId !== 'string') return null;
  if (type === 'renameHabit' && typeof input.name === 'string' && !validateHabitName(input.name)) {
    return { type, ...base, habitId: input.habitId, name: input.name.trim() };
  }
  if (type === 'setGoal' && typeof input.monthlyGoal === 'number'
      && !validateMonthlyGoal(input.monthlyGoal, year, month)) {
    return { type, ...base, habitId: input.habitId, monthlyGoal: input.monthlyGoal };
  }
  if (type === 'reorderHabit' && (input.direction === 'up' || input.direction === 'down')) {
    return { type, ...base, habitId: input.habitId, direction: input.direction };
  }
  if (type === 'removeHabit') return { type, ...base, habitId: input.habitId };
  if (type === 'setCompletion' && typeof input.date === 'string' && typeof input.completed === 'boolean') {
    return { type, ...base, habitId: input.habitId, date: input.date, completed: input.completed };
  }
  return null;
}

export async function PATCH(request: NextRequest) {
  const authResult = await getAuthenticatedUserId();
  if ('error' in authResult) return authResult.error;

  let operation: TrackerOperation | null = null;
  try {
    operation = parseOperation(await request.json());
  } catch {
    return errorResponse('Invalid JSON body.');
  }
  if (!operation) return errorResponse('Invalid habit tracker operation.');

  try {
    return NextResponse.json(await applyTrackerOperation(authResult.userId, operation));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The change could not be saved.';
    console.error('[Habit Tracker] Save failed:', error);
    if (message === 'Habit not found.' || message === 'Date does not belong to the selected month.') {
      return errorResponse(message, 404);
    }
    return errorResponse('The change could not be saved.', 500);
  }
}
