import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { buildMorningBuckets, listPipelineRows, summarise } from '@/server/partners/pipeline-queries';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const money = (minor: number) => `£${Math.round(minor / 100).toLocaleString()}`;

export default async function MorningPage() {
  const { admin, sb } = await requireAdmin('/admin/partners/morning');
  const sites = await listNetworkSites(sb);
  const [buckets, allRows] = await Promise.all([
    buildMorningBuckets(sb),
    listPipelineRows(sb),
  ]);
  const summary = summarise(allRows);
  const weightedACV = summary.reduce((a, s) => a + s.weighted_acv_minor, 0);
  const wonMonthly = summary.find((s) => s.stage === 'won')?.monthly_minor ?? 0;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/partners/morning">
      <SectionHeader
        eyebrow="Sales"
        title="Morning queue"
        description="What needs attention today. Overdue follow-ups appear first. Weighted ACV uses stage probabilities."
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/pipeline">Kanban</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners">Table view</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/first-wave">First wave</Link>
          </span>
        }
      />

      <Panel title="Today's numbers" eyebrow="Instant">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          <div className="metric-card">
            <div className="metric-label">Overdue follow-ups</div>
            <div className={`metric-value metric-value--${buckets.overdue.length ? 'ok' : 'no-data'}`}>{buckets.overdue.length}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Due today</div>
            <div className="metric-value metric-value--ok">{buckets.dueToday.length}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Wave awaiting first send</div>
            <div className="metric-value metric-value--ok">{buckets.waveAwaitingSend.length}</div>
            <div className="metric-helper">drafts ready, no email_sent yet</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Weighted ACV</div>
            <div className="metric-value metric-value--ok">{money(weightedACV)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Won monthly</div>
            <div className={`metric-value metric-value--${wonMonthly ? 'ok' : 'no-data'}`}>{money(wonMonthly)}</div>
          </div>
        </div>
      </Panel>

      {buckets.overdue.length > 0 && (
        <Panel title={`Overdue (${buckets.overdue.length})`} eyebrow="Act today">
          <Table
            rows={buckets.overdue}
            columns={[
              { key: 'name', header: 'Partner', render: (r) => <Link href={`/admin/partners/${r.id}`}>{r.display_name}</Link> },
              { key: 'stage', header: 'Stage', render: (r) => <StatusBadge state="warning" label={r.status.replace(/_/g, ' ')} /> },
              { key: 'action', header: 'Next action', render: (r) => <span style={{ fontSize: 12 }}>{r.next_action ?? '—'}</span> },
              { key: 'due', header: 'Due', render: (r) => <span style={{ color: '#dc2626', fontSize: 11 }}>{r.next_action_due}</span> },
              { key: 'price', header: 'Monthly', className: 'num', render: (r) => r.recommended_price_minor != null ? money(r.recommended_price_minor) : <span className="col-dim">—</span> },
            ]}
            empty={<span className="col-dim">Nothing overdue — good.</span>}
          />
        </Panel>
      )}

      {buckets.dueToday.length > 0 && (
        <Panel title={`Due today (${buckets.dueToday.length})`}>
          <Table
            rows={buckets.dueToday}
            columns={[
              { key: 'name', header: 'Partner', render: (r) => <Link href={`/admin/partners/${r.id}`}>{r.display_name}</Link> },
              { key: 'stage', header: 'Stage', render: (r) => <StatusBadge state="info" label={r.status.replace(/_/g, ' ')} /> },
              { key: 'action', header: 'Next action', render: (r) => <span style={{ fontSize: 12 }}>{r.next_action ?? '—'}</span> },
              { key: 'price', header: 'Monthly', className: 'num', render: (r) => r.recommended_price_minor != null ? money(r.recommended_price_minor) : <span className="col-dim">—</span> },
            ]}
          />
        </Panel>
      )}

      {buckets.dueThisWeek.length > 0 && (
        <Panel title={`Due this week (${buckets.dueThisWeek.length})`}>
          <Table
            rows={buckets.dueThisWeek}
            columns={[
              { key: 'name', header: 'Partner', render: (r) => <Link href={`/admin/partners/${r.id}`}>{r.display_name}</Link> },
              { key: 'stage', header: 'Stage', render: (r) => <StatusBadge state="info" label={r.status.replace(/_/g, ' ')} /> },
              { key: 'action', header: 'Next action', render: (r) => <span style={{ fontSize: 12 }}>{r.next_action ?? '—'}</span> },
              { key: 'due', header: 'Due', render: (r) => <span style={{ fontSize: 11 }}>{r.next_action_due}</span> },
            ]}
          />
        </Panel>
      )}

      {buckets.waveAwaitingSend.length > 0 && (
        <Panel title={`Wave drafts awaiting approval + send (${buckets.waveAwaitingSend.length})`} eyebrow="Review and press send">
          <Table
            rows={buckets.waveAwaitingSend}
            columns={[
              { key: 'name', header: 'Partner', render: (r) => <Link href={`/admin/partners/${r.id}`}>{r.display_name}</Link> },
              { key: 'category', header: 'Category', render: (r) => <span style={{ fontSize: 12 }}>{r.vendor_category ?? '—'}</span> },
              { key: 'fit', header: 'Fit', className: 'num', render: (r) => r.fit_score ?? '—' },
              { key: 'price', header: 'Monthly', className: 'num', render: (r) => r.recommended_price_minor != null ? money(r.recommended_price_minor) : <span className="col-dim">—</span> },
            ]}
          />
        </Panel>
      )}

      {buckets.recentInbound.length > 0 && (
        <Panel title={`Last 7 days inbound (${buckets.recentInbound.length})`}>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
            {buckets.recentInbound.map((r, i) => (
              <li key={`${r.partner_id}-${i}`} style={{ marginBottom: 6 }}>
                <Link href={`/admin/partners/${r.partner_id}`}>{r.display_name}</Link>
                {' '}<span style={{ fontSize: 11, color: '#6b7280' }}>· {formatRelative(r.occurred_at)}</span>
                <div style={{ fontSize: 12 }}>{r.summary}</div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Pipeline by stage" eyebrow="Stage counts + monthly value">
        <Table
          rows={summary.map((s, i) => ({ ...s, id: `${s.stage}-${i}` }))}
          columns={[
            { key: 'stage', header: 'Stage', render: (s) => <StatusBadge state={s.stage === 'won' ? 'success' : s.stage === 'lost' ? 'failed' : 'info'} label={s.stage.replace(/_/g, ' ')} /> },
            { key: 'count', header: 'Count', className: 'num', render: (s) => s.count },
            { key: 'monthly', header: 'Monthly', className: 'num', render: (s) => money(s.monthly_minor) },
            { key: 'acv', header: 'ACV', className: 'num', render: (s) => money(s.acv_minor) },
            { key: 'weighted', header: 'Weighted ACV', className: 'num', render: (s) => money(s.weighted_acv_minor) },
          ]}
          empty={<span className="col-dim">No pipeline rows yet.</span>}
        />
      </Panel>
    </AdminShell>
  );
}
