import { Suspense } from 'react';
import AppShell from '@/components/app-shell';
import VaultWorkspace from '@/components/vault/VaultWorkspace';

export default function VaultPage() {
  return (
    <AppShell variant="full">
      <Suspense fallback={null}>
        <VaultWorkspace />
      </Suspense>
    </AppShell>
  );
}
