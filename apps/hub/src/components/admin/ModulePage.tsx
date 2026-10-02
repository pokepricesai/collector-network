import type { ReactNode } from 'react';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from './AdminShell';
import { EmptyState, Panel, SectionHeader } from './admin-ui';

// Shared Phase-0 module placeholder. Each pillar page (SEO, Health,
// Content, Social, Revenue, Tasks, Alerts, Approvals, Automation,
// Integrations, Settings) uses this to render a protected, correctly
// laid-out shell listing the planned sections. Real functionality
// lands in later phases.

export interface ModulePageProps {
  pathname: string;
  eyebrow: string;
  title: string;
  description: string;
  sections: Array<{ title: string; description: ReactNode }>;
  headline?: ReactNode;
}

export async function ModulePage({
  pathname, eyebrow, title, description, sections, headline,
}: ModulePageProps) {
  const { admin, sb } = await requireAdmin(pathname);
  const sites = await listNetworkSites(sb);
  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname={pathname}>
      <SectionHeader eyebrow={eyebrow} title={title} description={description} />
      {headline}
      {sections.map((s) => (
        <Panel key={s.title} title={s.title} eyebrow={eyebrow}>
          <EmptyState title="Coming next" description={s.description} tone="muted" />
        </Panel>
      ))}
    </AdminShell>
  );
}
