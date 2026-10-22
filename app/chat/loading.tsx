import AppShell from '@/components/app-shell';
import { LoadingState } from '@/components/ui/states';

export default function Loading() {
  return (
    <AppShell variant="full">
      <div className="flex h-full items-center justify-center">
        <LoadingState message="Loading chat…" />
      </div>
    </AppShell>
  );
}
