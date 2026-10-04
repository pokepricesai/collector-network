import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';

function EmptyStateInline() {
  return <EmptyState title="No operating cost rows yet in the 28d window" description="AI + BigQuery autoflow when activity exists. Add Vercel/Supabase/domain lines manually." tone="muted" />;
}
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { totalCostsSinceGbp, listRecentOpsCosts, recentAiCosts, recentBqCosts } from '@/server/revenue/costs';
import { totalsSince } from '@/server/revenue/queries';
import { formatMoneyMinor, formatDateOnly, formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

interface PageProps { searchParams: Promise<{ inserted?: string }> }

export default async function CostsPage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/revenue/costs');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const since = daysAgoIso(28);

  const [costs, revenueTotals, opsRows, aiRows, bqRows] = await Promise.all([
    totalCostsSinceGbp(sb, since),
    totalsSince(sb, since),
    listRecentOpsCosts(sb, 60),
    recentAiCosts(sb, 10),
    recentBqCosts(sb, 10),
  ]);

  const gbpRevenueMinor = revenueTotals.find((r) => r.currency === 'GBP')?.net_minor ?? 0;
  const contributionMinor = gbpRevenueMinor - costs.total_minor;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue/costs">
      <SectionHeader
        eyebrow="Revenue"
        title="Costs + contribution profit"
        description="Last 28 days. AI costs read directly from network_ai_cost_log, BigQuery costs from network_job_runs.metadata.bq_est_cost_usd, operating costs from manual entries. Non-GBP amounts converted at a fixed session rate (see USD_TO_GBP)."
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="status-badge status-active" href="/admin/revenue/costs/new">+ Operating cost</Link>
            <Link className="status-badge status-not_connected" href="/admin/revenue">← Dashboard</Link>
          </span>
        }
      />
      {sp.inserted === '1' && (
        <Panel title="Cost recorded" eyebrow="OK"><span className="col-dim" style={{ fontSize: 12 }}>Operating cost row saved. Dashboard revalidated.</span></Panel>
      )}

      <Panel title="Contribution profit (GBP, 28d)" eyebrow="Operational view only">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          <div className="metric-card">
            <div className="metric-label">GBP revenue</div>
            <div className="metric-value metric-value--ok">{formatMoneyMinor(gbpRevenueMinor, 'GBP')}</div>
            <div className="metric-helper">net of refunds/reversals</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Direct costs</div>
            <div className="metric-value metric-value--muted">{formatMoneyMinor(costs.total_minor, 'GBP')}</div>
            <div className="metric-helper">AI {formatMoneyMinor(costs.ai_minor, 'GBP')} · BQ {formatMoneyMinor(costs.bq_minor, 'GBP')} · Ops {formatMoneyMinor(costs.ops_minor, 'GBP')}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Contribution</div>
            <div className={`metric-value ${contributionMinor >= 0 ? 'metric-value--ok' : 'metric-value--not-connected'}`}>{formatMoneyMinor(contributionMinor, 'GBP')}</div>
            <div className="metric-helper">revenue − direct costs</div>
          </div>
        </div>
        <p className="col-dim" style={{ fontSize: 11, marginTop: 10 }}>
          Contribution profit is an operational signal, not statutory accounting. Non-GBP revenue is NOT included in this line and is reported separately on the main dashboard.
        </p>
      </Panel>

      <Panel title="Cost breakdown by category (28d)" eyebrow="Where the money goes">
        {(() => {
          const buckets = new Map<string, number>();
          buckets.set('AI', costs.ai_minor);
          buckets.set('BigQuery', costs.bq_minor);
          for (const r of opsRows.filter((o) => o.for_date >= since)) {
            const key = ({
              hosting: 'Vercel / hosting',
              supabase: 'Supabase',
              domain: 'Domains',
              saas: 'SaaS',
              tool: 'Tools',
              other: 'Other',
            } as Record<string, string>)[r.category] ?? r.category;
            const amount = r.currency === 'GBP' ? r.amount_minor : Math.round(r.amount_minor * 0.80);
            buckets.set(key, (buckets.get(key) ?? 0) + amount);
          }
          const rows = Array.from(buckets.entries())
            .filter(([, v]) => v > 0)
            .sort(([, a], [, b]) => b - a);
          if (rows.length === 0) return <EmptyStateInline />;
          const total = rows.reduce((s, [, v]) => s + v, 0);
          return (
            <Table
              rows={rows.map(([name, minor], i) => ({ id: i, name, minor, pct: total > 0 ? minor / total : 0 }))}
              columns={[
                { key: 'name', header: 'Category', render: (r) => <strong>{r.name}</strong> },
                { key: 'amount', header: 'Amount', className: 'num', render: (r) => formatMoneyMinor(r.minor, 'GBP') },
                { key: 'pct', header: '% of total', className: 'num', render: (r) => `${(r.pct * 100).toFixed(0)}%` },
              ]}
            />
          );
        })()}
        <p className="col-dim" style={{ fontSize: 11, marginTop: 10 }}>
          Vercel + Supabase totals require manual-entry rows via <Link href="/admin/revenue/costs/new">+ Operating cost</Link>. We never fabricate billing figures from traffic or usage.
        </p>
      </Panel>

      <Panel title="Operating costs (manual, newest 60)" eyebrow="Direct opex">
        <Table
          rows={opsRows}
          columns={[
            { key: 'date', header: 'Date', render: (r) => <code>{formatDateOnly(r.for_date)}</code> },
            { key: 'cat', header: 'Category', render: (r) => <StatusBadge state="info" label={r.category} /> },
            { key: 'prov', header: 'Provider', render: (r) => r.provider ?? <span className="col-dim">—</span> },
            { key: 'site', header: 'Site', render: (r) => r.network_sites?.name ?? <span className="col-dim">Network</span> },
            { key: 'desc', header: 'Description', render: (r) => <span style={{ fontSize: 12 }}>{r.description ?? ''}</span> },
            { key: 'amount', header: 'Amount', className: 'num', render: (r) => formatMoneyMinor(r.amount_minor, r.currency) },
          ]}
          empty={<span className="col-dim">No operating costs entered yet. Click &quot;+ Operating cost&quot; to add Vercel / Supabase / domain lines.</span>}
        />
      </Panel>

      <Panel title="AI costs (last 10)" eyebrow="Read-through from network_ai_cost_log">
        <Table
          rows={aiRows.map((r, i) => ({ id: i, ...r }))}
          columns={[
            { key: 'when', header: 'When', render: (r) => <span className="col-dim" style={{ fontSize: 11 }}>{formatRelative(r.created_at)}</span> },
            { key: 'op', header: 'Operation', render: (r) => <code>{r.operation}</code> },
            { key: 'model', header: 'Model', render: (r) => <code style={{ fontSize: 11 }}>{r.model}</code> },
            { key: 'cost', header: 'USD', className: 'num', render: (r) => `$${Number(r.est_cost_usd).toFixed(4)}` },
          ]}
          empty={<span className="col-dim">No AI cost rows yet.</span>}
        />
      </Panel>

      <Panel title="BigQuery costs (last 10)" eyebrow="Read-through from network_job_runs.metadata">
        <Table
          rows={bqRows.map((r, i) => ({ id: i, ...r }))}
          columns={[
            { key: 'when', header: 'When', render: (r) => <span className="col-dim" style={{ fontSize: 11 }}>{formatRelative(r.started_at)}</span> },
            { key: 'job', header: 'Job', render: (r) => <code>{r.job_name}</code> },
            { key: 'cost', header: 'USD', className: 'num', render: (r) => r.bq_est_cost_usd != null ? `$${r.bq_est_cost_usd.toFixed(4)}` : '—' },
          ]}
          empty={<span className="col-dim">No BigQuery cost rows yet.</span>}
        />
      </Panel>
    </AdminShell>
  );
}
