import AppShell from '@/components/app-shell';
import { LoadingState } from '@/components/ui/states';

export default function Loading() {
  return (
    <AppShell variant="contained">
      <LoadingState message="Loading ranking…" />
    </AppShell>
  );
}
