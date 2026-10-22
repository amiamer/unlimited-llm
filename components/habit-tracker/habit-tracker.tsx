'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  analyzeHabit,
  calendarDays,
  dailyProgress,
  daysInMonth,
  rankTopHabits,
  validateHabitName,
  validateMonthlyGoal,
  weekSegments,
  weeklyProgress,
  type TrackerSnapshot,
} from '@/lib/habit-tracker/model';
import type { TrackerOperation } from '@/lib/habit-tracker/store';

const MONTHS = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, index, 1))),
);
const YEARS = Array.from({ length: 301 }, (_, index) => 1900 + index);

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function progressWidth(value: number | null): string {
  return `${value === null ? 0 : Math.max(0, Math.min(100, value))}%`;
}

export default function HabitTracker() {
  const now = useMemo(() => new Date(), []);
  const [snapshot, setSnapshot] = useState<TrackerSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [retryOperation, setRetryOperation] = useState<TrackerOperation | null>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('20');
  const [formError, setFormError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch(`/api/habit-tracker?year=${now.getFullYear()}&month=${now.getMonth() + 1}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Your tracker could not be loaded.');
      setSnapshot(await response.json() as TrackerSnapshot);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Your tracker could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [now]);

  useEffect(() => { void load(); }, [load]);

  const applyOptimistic = useCallback((operation: TrackerOperation) => {
    setSnapshot((current) => {
      if (!current) return current;
      if (operation.type === 'selectMonth') return current;
      const habits = current.month.habits.map((habit) => ({ ...habit, completions: [...habit.completions] }));
      const index = 'habitId' in operation ? habits.findIndex((habit) => habit.id === operation.habitId) : -1;
      if (operation.type === 'createHabit') {
        habits.push({ id: `pending-${Date.now()}`, name: operation.name, monthlyGoal: operation.monthlyGoal, order: habits.length, completions: [] });
      } else if (operation.type === 'renameHabit' && index >= 0) {
        habits[index].name = operation.name;
      } else if (operation.type === 'setGoal' && index >= 0) {
        habits[index].monthlyGoal = operation.monthlyGoal;
      } else if (operation.type === 'removeHabit' && index >= 0) {
        habits.splice(index, 1);
      } else if (operation.type === 'reorderHabit' && index >= 0) {
        const target = operation.direction === 'up' ? index - 1 : index + 1;
        if (target >= 0 && target < habits.length) [habits[index], habits[target]] = [habits[target], habits[index]];
      } else if (operation.type === 'setCompletion' && index >= 0) {
        const values = new Set(habits[index].completions);
        if (operation.completed) values.add(operation.date);
        else values.delete(operation.date);
        habits[index].completions = [...values];
      }
      habits.forEach((habit, order) => { habit.order = order; });
      return { ...current, month: { ...current.month, configured: habits.length > 0 || current.month.configured, habits } };
    });
  }, []);

  const persist = useCallback(async (operation: TrackerOperation, optimistic = true) => {
    if (optimistic) applyOptimistic(operation);
    setSaveState('saving');
    setRetryOperation(null);
    try {
      const response = await fetch('/api/habit-tracker', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(operation),
      });
      if (!response.ok) throw new Error('Save failed.');
      setSnapshot(await response.json() as TrackerSnapshot);
      setSaveState('saved');
    } catch {
      setRetryOperation(operation);
      setSaveState('error');
    }
  }, [applyOptimistic]);

  const changeMonth = useCallback((year: number, month: number) => {
    let nextYear = year;
    let nextMonth = month;
    if (nextMonth < 1) { nextMonth = 12; nextYear -= 1; }
    if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
    if (nextYear < 1900 || nextYear > 2200) return;
    void persist({ type: 'selectMonth', year: nextYear, month: nextMonth }, false);
  }, [persist]);

  if (loading) return <div className="py-24 text-center text-sm text-muted-foreground">Loading habit tracker…</div>;
  if (loadError || !snapshot) {
    return (
      <Card><CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <p role="alert">{loadError || 'Your tracker could not be loaded.'}</p>
        <Button onClick={() => void load()}><RotateCcw /> Try again</Button>
      </CardContent></Card>
    );
  }

  const { selectedYear: year, selectedMonth: month } = snapshot;
  const habits = snapshot.month.habits;
  const days = calendarDays(year, month);
  const weeks = weekSegments(days);
  const analysis = habits.map(analyzeHabit);
  const ranked = rankTopHabits(habits);

  const addHabit = () => {
    const numericGoal = Number(goal);
    const error = validateHabitName(name) || validateMonthlyGoal(numericGoal, year, month);
    if (error) { setFormError(error); return; }
    void persist({ type: 'createHabit', year, month, name: name.trim(), monthlyGoal: numericGoal });
    setName('');
    setFormError('');
    nameInputRef.current?.focus();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Monthly workspace</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Personalized Habit Tracker</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Set this month&apos;s priorities, mark each day, and review your consistency.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Month navigation">
          <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Previous month"
            onClick={() => changeMonth(year, month - 1)}><ChevronLeft /></Button>
          <select className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Month" value={month} onChange={(event) => changeMonth(year, Number(event.target.value))}>
            {MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
          </select>
          <select className="h-11 rounded-md border border-input bg-background px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Year" value={year} onChange={(event) => changeMonth(Number(event.target.value), month)}>
            {YEARS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Next month"
            onClick={() => changeMonth(year, month + 1)}><ChevronRight /></Button>
        </div>
      </header>

      <div className="flex min-h-6 items-center justify-end gap-2 text-xs" aria-live="polite">
        {saveState === 'saving' && <span className="text-muted-foreground">Saving…</span>}
        {saveState === 'saved' && <span>Saved</span>}
        {saveState === 'error' && <><span className="text-destructive">Couldn&apos;t save this change.</span>
          <Button size="sm" variant="outline" onClick={() => retryOperation && void persist(retryOperation, false)}>Retry</Button></>}
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle>Add a habit</CardTitle>
          <CardDescription>Habits are configured independently for {MONTHS[month - 1]} {year}.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto]" onSubmit={(event) => { event.preventDefault(); addHabit(); }}>
            <div>
              <label htmlFor="habit-name" className="mb-1 block text-xs font-medium">Habit name</label>
              <Input ref={nameInputRef} id="habit-name" value={name} maxLength={80}
                aria-describedby={formError ? 'habit-form-error' : undefined}
                onChange={(event) => { setName(event.target.value); setFormError(''); }} placeholder="Read for 30 minutes" />
            </div>
            <div>
              <label htmlFor="habit-goal" className="mb-1 block text-xs font-medium">Monthly goal</label>
              <Input id="habit-goal" type="number" min={1} max={daysInMonth(year, month)} step={1} value={goal}
                aria-describedby={formError ? 'habit-form-error' : undefined}
                onChange={(event) => { setGoal(event.target.value); setFormError(''); }} />
            </div>
            <Button type="submit" className="h-11 self-end"><Plus /> Add habit</Button>
          </form>
          {formError && <p id="habit-form-error" role="alert" className="mt-2 text-sm text-destructive">{formError}</p>}
        </CardContent>
      </Card>

      <section aria-labelledby="progress-heading">
        <div className="mb-3">
          <h2 id="progress-heading" className="text-xl font-semibold">Progress</h2>
          <p className="text-sm text-muted-foreground">Daily and seven-day completion rates.</p>
        </div>
        <div className="space-y-3 overflow-x-auto rounded-xl border border-border bg-card p-4">
          <div className="min-w-[760px]">
            <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">Daily</h3>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(20px, 1fr))` }}>
              {days.map((day) => {
                const value = dailyProgress(habits, day.dateKey);
                return <div key={day.dateKey} className="text-center" title={`${day.weekday} ${day.day}: ${value === null ? 'No data' : `${value}%`}`}>
                  <div className="mx-auto flex h-20 w-3 items-end overflow-hidden rounded-full bg-muted" role="progressbar"
                    aria-label={`${day.weekday} ${day.day} daily progress`} aria-valuemin={0} aria-valuemax={100}
                    aria-valuenow={value ?? undefined} aria-valuetext={value === null ? 'No data' : `${value}%`}>
                    <div className="w-full bg-foreground transition-[height] motion-reduce:transition-none" style={{ height: progressWidth(value) }} />
                  </div>
                  <span className="mt-1 block font-mono text-[10px] tabular-nums">{day.day}</span>
                  <span className="sr-only">{value === null ? 'No data' : `${value}%`}</span>
                </div>;
              })}
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">Weekly</h3>
            <div className="grid gap-3 sm:grid-cols-5">
              {weeks.map((week) => {
                const value = weeklyProgress(habits, week);
                return <div key={week.label}>
                  <div className="mb-1 flex justify-between font-mono text-xs"><span>{week.label}</span><span>{value === null ? '—' : `${value}%`}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${week.label} progress`}
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-valuetext={value === null ? 'No data' : `${value}%`}>
                    <div className="h-full bg-foreground transition-[width] motion-reduce:transition-none" style={{ width: progressWidth(value) }} />
                  </div>
                </div>;
              })}
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="matrix-heading">
        <div className="mb-3">
          <h2 id="matrix-heading" className="text-xl font-semibold">Daily check-in</h2>
          <p className="text-sm text-muted-foreground">Every check is saved to your account.</p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          {habits.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-muted-foreground">No habits configured for this month.</p>
              <Button variant="outline" onClick={() => nameInputRef.current?.focus()}><Plus /> Create your first habit</Button>
            </div>
          ) : (
            <table className="w-max min-w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-20 min-w-48 border-b border-r border-border bg-card p-3 text-left">Habit</th>
                  {days.map((day) => <th scope="col" key={day.dateKey} className="min-w-11 border-b border-r border-border p-1 text-center font-mono text-[10px] font-normal">
                    <span className="block uppercase text-muted-foreground">{day.weekday}</span><span className="block text-xs">{day.day}</span>
                  </th>)}
                </tr>
              </thead>
              <tbody>
                {habits.map((habit) => <tr key={habit.id}>
                  <th scope="row" className="sticky left-0 z-10 max-w-64 border-b border-r border-border bg-card p-3 text-left font-medium">
                    <span className="block truncate">{habit.name}</span>
                  </th>
                  {days.map((day) => {
                    const checked = habit.completions.includes(day.dateKey);
                    return <td key={day.dateKey} className="h-11 w-11 border-b border-r border-border p-0 text-center">
                      <label className="flex h-11 w-11 cursor-pointer items-center justify-center focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring">
                        <input type="checkbox" checked={checked} className="h-5 w-5 accent-foreground"
                          aria-label={`${habit.name}, ${day.weekday} ${MONTHS[month - 1]} ${day.day}, ${year}`}
                          onChange={(event) => void persist({ type: 'setCompletion', year, month, habitId: habit.id, date: day.dateKey, completed: event.target.checked })} />
                      </label>
                    </td>;
                  })}
                </tr>)}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <section aria-labelledby="analysis-heading">
          <div className="mb-3">
            <h2 id="analysis-heading" className="text-xl font-semibold">Habit analysis</h2>
            <p className="text-sm text-muted-foreground">Edit names and goals, or change the display order.</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            {analysis.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Analysis appears after you add a habit.</p> :
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead><tr className="border-b border-border text-left font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="p-3">Habit</th><th className="p-3">Goal</th><th className="p-3">Actual</th><th className="p-3">Left</th><th className="p-3">Progress</th><th className="p-3">Actions</th>
                </tr></thead>
                <tbody>{analysis.map((item, index) => <HabitAnalysisRow key={item.habit.id} item={item} index={index} count={analysis.length}
                  year={year} month={month} persist={persist} />)}</tbody>
              </table>}
          </div>
        </section>

        <section aria-labelledby="ranking-heading">
          <div className="mb-3">
            <h2 id="ranking-heading" className="text-xl font-semibold">Top 10 habits</h2>
            <p className="text-sm text-muted-foreground">Ranked by goal progress, completions, then order.</p>
          </div>
          <Card className="overflow-hidden rounded-xl">
            <CardContent className="p-0">
              {ranked.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No habits to rank yet.</p> :
                <ol>{ranked.map((item, index) => <li key={item.habit.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border p-4 last:border-b-0">
                  <span className="font-mono text-sm tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                  <div className="min-w-0"><p className="truncate font-medium">{item.habit.name}</p><p className="font-mono text-xs text-muted-foreground">{item.actual} / {item.habit.monthlyGoal}</p></div>
                  <span className="font-mono text-sm font-semibold tabular-nums">{item.percentage}%</span>
                </li>)}</ol>}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

interface HabitAnalysisRowProps {
  item: ReturnType<typeof analyzeHabit>;
  index: number;
  count: number;
  year: number;
  month: number;
  persist: (operation: TrackerOperation, optimistic?: boolean) => Promise<void>;
}

function HabitAnalysisRow({ item, index, count, year, month, persist }: HabitAnalysisRowProps) {
  const [editName, setEditName] = useState(item.habit.name);
  const [editGoal, setEditGoal] = useState(String(item.habit.monthlyGoal));
  const [error, setError] = useState('');

  useEffect(() => setEditName(item.habit.name), [item.habit.name]);
  useEffect(() => setEditGoal(String(item.habit.monthlyGoal)), [item.habit.monthlyGoal]);

  const saveName = () => {
    const validation = validateHabitName(editName);
    if (validation) { setError(validation); return; }
    setError('');
    if (editName.trim() !== item.habit.name) void persist({ type: 'renameHabit', year, month, habitId: item.habit.id, name: editName.trim() });
  };
  const saveGoal = () => {
    const value = Number(editGoal);
    const validation = validateMonthlyGoal(value, year, month);
    if (validation) { setError(validation); return; }
    setError('');
    if (value !== item.habit.monthlyGoal) void persist({ type: 'setGoal', year, month, habitId: item.habit.id, monthlyGoal: value });
  };

  return <tr className="border-b border-border last:border-b-0">
    <td className="p-3"><Input className="min-w-48" value={editName} maxLength={80} aria-label={`Name for ${item.habit.name}`}
      aria-invalid={Boolean(error)} onChange={(event) => setEditName(event.target.value)} onBlur={saveName}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      {error && <p role="alert" className="mt-1 max-w-48 text-xs text-destructive">{error}</p>}</td>
    <td className="p-3"><Input className="w-20 font-mono tabular-nums" type="number" min={1} max={daysInMonth(year, month)} step={1}
      value={editGoal} aria-label={`Monthly goal for ${item.habit.name}`} aria-invalid={Boolean(error)}
      onChange={(event) => setEditGoal(event.target.value)} onBlur={saveGoal}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></td>
    <td className="p-3 font-mono tabular-nums">{item.actual}</td>
    <td className="p-3 font-mono tabular-nums">{item.left}</td>
    <td className="p-3"><div className="mb-1 flex justify-between gap-4 font-mono text-xs"><span>{item.percentage}%</span><span className="text-muted-foreground">{item.actual}/{item.habit.monthlyGoal}</span></div>
      <div className="h-2 min-w-28 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${item.habit.name} goal progress`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.boundedPercentage} aria-valuetext={`${item.percentage}%`}>
        <div className="h-full bg-foreground transition-[width] motion-reduce:transition-none" style={{ width: `${item.boundedPercentage}%` }} /></div></td>
    <td className="p-3"><div className="flex gap-1">
      <Button size="icon" variant="ghost" className="h-11 w-11" disabled={index === 0} aria-label={`Move ${item.habit.name} up`}
        onClick={() => void persist({ type: 'reorderHabit', year, month, habitId: item.habit.id, direction: 'up' })}><ChevronUp /></Button>
      <Button size="icon" variant="ghost" className="h-11 w-11" disabled={index === count - 1} aria-label={`Move ${item.habit.name} down`}
        onClick={() => void persist({ type: 'reorderHabit', year, month, habitId: item.habit.id, direction: 'down' })}><ChevronDown /></Button>
      <Button size="icon" variant="ghost" className="h-11 w-11 text-destructive" aria-label={`Remove ${item.habit.name}`}
        onClick={() => { if (window.confirm(`Remove “${item.habit.name}” and its completions?`)) void persist({ type: 'removeHabit', year, month, habitId: item.habit.id }); }}><Trash2 /></Button>
    </div></td>
  </tr>;
}
