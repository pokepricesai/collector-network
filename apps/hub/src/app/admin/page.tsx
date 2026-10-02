import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  EmptyState, MetricCard, Panel, SectionHeader, StatusBadge, Table,
} from '@/components/admin/admin-ui';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

// Overview — the "What should we work on today?" executive
// dashboard. Phase 0 renders the shell honestly: metric cards show
// 'Not connected' until the real integrations exist, and the five-
// site table shows status with placeholder values. No fake numbers.

const METRICS: Array<{ code: string; label: string }> = [
  { code: 'users',              label: 'Users' },
  { code: 'sessions',           label: 'Sessions' },
  { code: 'google_clicks',      label: 'Google clicks' },
  { code: 'google_impressions', label: 'Google impressions' },
  { code: 'affiliate_clicks',   label: 'Affiliate clicks' },
  { code: 'affiliate_revenue',  label: 'Affiliate revenue' },
  { code: 'other_revenue',      label: 'Other revenue' },
  { code: 'total_revenue',      label: 'Total revenue' },
  { code: 'operating_cost',     label: 'Operating costs' },
  { code: 'net_profit',         label: 'Net profit' },
  { code: 'new_accounts',       label: 'New accounts' },
  { code: 'indexed_pages',      label: 'Indexed pages' },
  { code: 'x_followers',        label: 'X followers' },
  { code: 'articles_published', label: 'Articles published' },
];

const RANGES = ['Today', '7 days', '28 days', 'Previous period'] as const;

export default async function OverviewPage() {
  const { admin, sb } = await requireAdmin('/admin');
  const sites = await listNetworkSites(sb);

  // Phase 0: no integrations connected yet, so every metric card
  // is honestly 'Not connected'. The range selector is scaffolded
  // but inert.

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin">
      <SectionHeader
        eyebrow="Overview"
        title="What should we work on today?"
        description="Executive view of the five Collector Network platforms. Integrations are not yet connected in Phase 0; numbers appear once Google Search Console and Google Analytics are wired in Phase 1."
        actions={
          <div className="admin-site-switcher-trigger" aria-disabled>
            <span className="admin-site-switcher-eyebrow">Range</span>
            <span className="admin-site-switcher-name">{RANGES[2]}</span>
            <span className="admin-site-switcher-chev">▾</span>
          </div>
        }
      />

      <div className="metric-grid">
        {METRICS.map((m) => (
          <MetricCard
            key={m.code}
            label={m.label}
            state="not-connected"
            helper="Awaits Phase 1 integrations"
          />
        ))}
      </div>

      <Panel title="Site portfolio" eyebrow="Sites">
        <Table
          columns={[
            {
              key: 'site',
              header: 'Site',
              render: (s) => (
                <Link href={`/admin/sites/${s.slug}`}>{s.name}</Link>
              ),
            },
            {
              key: 'users',
              header: 'Users',
              className: 'col-num col-dim',
              render: () => 'Not connected',
            },
            {
              key: 'clicks',
              header: 'Google clicks',
              className: 'col-num col-dim',
              render: () => 'Not connected',
            },
            {
              key: 'revenue',
              header: 'Revenue',
              className: 'col-num col-dim',
              render: () => 'Not connected',
            },
            {
              key: 'indexed',
              header: 'Indexed',
              className: 'col-num col-dim',
              render: () => 'No data yet',
            },
            {
              key: 'health',
              header: 'Health',
              render: (s) => <StatusBadge state={s.status} />,
            },
          ]}
          rows={sites.map((s) => ({ ...s, id: s.id }))}
          empty={
            <EmptyState
              title="No sites in the registry"
              description="Run the Phase 0 migration to seed the five sites."
            />
          }
        />
      </Panel>

      <Panel title="Operational signals" eyebrow="Attention">
        <EmptyState
          title="Nothing to action yet"
          description="Tasks, alerts and approvals will populate as later phases connect the data feeds that generate them."
          tone="muted"
        />
      </Panel>
    </AdminShell>
  );
}
