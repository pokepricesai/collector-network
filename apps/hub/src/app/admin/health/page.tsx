import { ModulePage } from '@/components/admin/ModulePage';

export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  return (
    <ModulePage
      pathname="/admin/health"
      eyebrow="Health"
      title="Network health"
      description="Uptime, deploy state, ingest freshness and error signal across the five sites. Phase 1 wires Vercel + the shared cron."
      sections={[
        { title: 'Deployments', description: 'Latest production state per Vercel project.' },
        { title: 'Cron',        description: 'Last run of the hourly network cron, with freshness thresholds.' },
        { title: 'Ingest',      description: 'TCGgraph / Scryfall / affiliate ingest state per site.' },
        { title: 'Errors',      description: 'Rolled-up 5xx and runtime errors.' },
      ]}
    />
  );
}
