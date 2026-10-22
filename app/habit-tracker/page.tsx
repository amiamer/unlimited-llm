import AppShell from '@/components/app-shell';
import HabitTracker from '@/components/habit-tracker/habit-tracker';

export default function HabitTrackerPage() {
  return (
    <AppShell variant="contained" brand="Habit Tracker">
      <HabitTracker />
    </AppShell>
  );
}
