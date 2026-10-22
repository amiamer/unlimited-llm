'use client';

import AppShell from '@/components/app-shell';
import { ReadingList } from '@/components/reading-list/ReadingList';

export default function ReadingListPage() {
  return (
    <AppShell variant="contained">
      <ReadingList />
    </AppShell>
  );
}
