export interface Habit {
  id: string;
  name: string;
  monthlyGoal: number;
  order: number;
  completions: string[];
}

export interface MonthTracker {
  year: number;
  month: number;
  configured: boolean;
  habits: Habit[];
}

export interface TrackerSnapshot {
  selectedYear: number;
  selectedMonth: number;
  month: MonthTracker;
}

export interface CalendarDay {
  day: number;
  dateKey: string;
  weekday: string;
}

export interface WeekSegment {
  label: string;
  days: CalendarDay[];
}

export interface HabitAnalysis {
  habit: Habit;
  actual: number;
  left: number;
  percentage: number;
  boundedPercentage: number;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function calendarDays(year: number, month: number, locale?: string): CalendarDay[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: daysInMonth(year, month) }, (_, index) => {
    const day = index + 1;
    return {
      day,
      dateKey: dateKey(year, month, day),
      weekday: formatter.format(new Date(Date.UTC(year, month - 1, day))),
    };
  });
}

export function weekSegments(days: CalendarDay[]): WeekSegment[] {
  return Array.from({ length: 5 }, (_, index) => ({
    label: `Week ${index + 1}`,
    days: days.slice(index * 7, index === 4 ? days.length : (index + 1) * 7),
  })).filter((segment) => segment.days.length > 0);
}

export function validateHabitName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter a habit name.';
  if (trimmed.length > 80) return 'Habit names must be 80 characters or fewer.';
  return null;
}

export function validateMonthlyGoal(value: number, year: number, month: number): string | null {
  if (!Number.isInteger(value) || value < 1 || value > daysInMonth(year, month)) {
    return `Enter a whole number from 1 to ${daysInMonth(year, month)}.`;
  }
  return null;
}

export function analyzeHabit(habit: Habit): HabitAnalysis {
  const actual = new Set(habit.completions).size;
  const percentage = Math.round((actual / habit.monthlyGoal) * 100);
  return {
    habit,
    actual,
    left: Math.max(0, habit.monthlyGoal - actual),
    percentage,
    boundedPercentage: Math.min(100, percentage),
  };
}

export function dailyProgress(habits: Habit[], dayKey: string): number | null {
  if (habits.length === 0) return null;
  const completed = habits.filter((habit) => habit.completions.includes(dayKey)).length;
  return Math.round((completed / habits.length) * 100);
}

export function weeklyProgress(habits: Habit[], segment: WeekSegment): number | null {
  if (habits.length === 0 || segment.days.length === 0) return null;
  const keys = new Set(segment.days.map((day) => day.dateKey));
  const completed = habits.reduce(
    (total, habit) => total + habit.completions.filter((key) => keys.has(key)).length,
    0,
  );
  return Math.round((completed / (habits.length * segment.days.length)) * 100);
}

export function rankTopHabits(habits: Habit[]): HabitAnalysis[] {
  return habits
    .map(analyzeHabit)
    .sort((a, b) =>
      b.percentage - a.percentage
      || b.actual - a.actual
      || a.habit.order - b.habit.order,
    )
    .slice(0, 10);
}
