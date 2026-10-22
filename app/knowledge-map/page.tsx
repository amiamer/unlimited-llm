'use client';

import AppShell from '@/components/app-shell';
import { KnowledgeMap } from '@/components/knowledge-map/KnowledgeMap';

export default function KnowledgeMapPage() {
  return (
    <AppShell variant="full">
      <KnowledgeMap />
    </AppShell>
  );
}
