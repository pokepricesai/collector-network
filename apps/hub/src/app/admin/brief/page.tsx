import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { MetricCard, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { buildBrief } from '@/server/brief/engine';
import { formatDelta, formatInt } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Params { searchParams: Promise<{ all?: string }> }

export default async function BriefPage({ searchParams }: Params) {
  const { admin, sb } = await requireAdmin('/admin/brief');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const showAll = sp.all === '1';
  const today = new Date();
  const brief = await buildBrief(sb, today);
  const topActions = showAll ? brief.actions : brief.actions.slice(0, 5);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/brief">
      <SectionHeader
        eyebrow="Daily operating brief"
        title={`What should we work on today?`}
        description={`Deterministic brief for ${brief.forDate}. Numbers below are real: GSC + GA4 for the latest available day. Priorities are explained — click into each action for context.`}
      />

      <Panel title="Network yesterday" eyebrow={brief.metrics.yesterday.date ? `Day of ${brief.metrics.yesterday.date}` : 'No data'}>
        <div className="metric-grid metric-grid--compact">
          <MetricCard
            label="Users"
            value={brief.metrics.yesterday.activeUsers ? formatInt(brief.metrics.yesterday.activeUsers) : null}
            state={brief.metrics.yesterday.activeUsers ? 'ok' : 'no-data'}
            helper={brief.metrics.priorDay.activeUsers ? formatDelta(brief.metrics.yesterday.activeUsers, brief.metrics.priorDay.activeUsers).label : undefined}
          />
          <MetricCard
            label="Sessions"
            value={brief.metrics.yesterday.sessions ? formatInt(brief.metrics.yesterday.sessions) : null}
            state={brief.metrics.yesterday.sessions ? 'ok' : 'no-data'}
            helper={brief.metrics.priorDay.sessions ? formatDelta(brief.metrics.yesterday.sessions, brief.metrics.priorDay.sessions).label : undefined}
          />
          <MetricCard
            label="Google clicks"
            value={brief.metrics.yesterday.googleClicks ? formatInt(brief.metrics.yesterday.googleClicks) : null}
            state={brief.metrics.yesterday.googleClicks ? 'ok' : 'no-data'}
            helper={brief.metrics.priorDay.googleClicks ? formatDelta(brief.metrics.yesterday.googleClicks, brief.metrics.priorDay.googleClicks).label : undefined}
          />
          <MetricCard
            label="Google impressions"
            value={brief.metrics.yesterday.googleImpressions ? formatInt(brief.metrics.yesterday.googleImpressions) : null}
            state={brief.metrics.yesterday.googleImpressions ? 'ok' : 'no-data'}
            helper={brief.metrics.priorDay.googleImpressions ? formatDelta(brief.metrics.yesterday.googleImpressions, brief.metrics.priorDay.googleImpressions).label : undefined}
          />
        </div>
      </Panel>

      <Panel title={`Today's recommended actions`} eyebrow={showAll ? `${brief.actions.length} total` : `Top ${topActions.length} of ${brief.actions.length}`}>
        {topActions.length === 0 ? (
          <div className="admin-empty admin-empty--muted"><div className="admin-empty-title">Nothing requires attention right now.</div></div>
        ) : (
          <Table
            columns={[
              { key: 'pri', header: 'Priority', render: (r: typeof topActions[number]) => <StatusBadge state={r.priority} /> },
              { key: 'title', header: 'Action', render: (r) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 520 }}>
                  <Link href={r.link} style={{ fontWeight: 600 }}>{r.title}</Link>
                  <span className="col-dim" style={{ fontSize: 12 }}>{r.description}</span>
                  <span className="col-dim" style={{ fontSize: 11 }}>Why: {r.reasoning}{r.siteSlug ? ` · ${r.siteSlug}` : ''}</span>
                </div>
              ) },
              { key: 'src', header: 'Source', render: (r) => <StatusBadge state="info" label={r.source.replace(/_/g, ' ')} /> },
              { key: 'go',  header: '', render: (r) => <Link className="status-badge status-opportunity" href={r.link}>Open →</Link> },
            ]}
            rows={topActions}
          />
        )}
        {!showAll && brief.actions.length > 5 && (
          <div style={{ marginTop: 12 }}>
            <Link className="status-badge status-not_connected" href="/admin/brief?all=1">View all {brief.actions.length} →</Link>
          </div>
        )}
      </Panel>

      <Panel title="Notable changes" eyebrow="Signals">
        {brief.notable.length === 0 ? (
          <div className="admin-empty admin-empty--muted"><div className="admin-empty-title">Nothing notable in the last 24h.</div></div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {brief.notable.map((n) => (
              <div key={n.id} style={{ padding: '10px 12px', border: '1px solid #E6E6E6', borderRadius: 6, display: 'flex', alignItems: 'start', gap: 10 }}>
                <StatusBadge state={n.severity === 'info' ? 'info' : n.severity} label={n.kind.replace(/_/g, ' ')} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                  <strong style={{ fontSize: 13 }}>{n.title}</strong>
                  <span className="col-dim" style={{ fontSize: 12 }}>{n.description}</span>
                </div>
                {n.link && <Link className="status-badge status-not_connected" href={n.link}>Open →</Link>}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="28-day pulse" eyebrow="Window">
        <div className="metric-grid metric-grid--compact">
          <MetricCard label="Users (28d)" value={formatInt(brief.metrics.windowDaily.activeUsers)} helper={formatDelta(brief.metrics.windowDaily.activeUsers, brief.metrics.priorWindowDaily.activeUsers).label} />
          <MetricCard label="Sessions (28d)" value={formatInt(brief.metrics.windowDaily.sessions)} helper={formatDelta(brief.metrics.windowDaily.sessions, brief.metrics.priorWindowDaily.sessions).label} />
          <MetricCard label="Google clicks (28d)" value={formatInt(brief.metrics.windowDaily.googleClicks)} helper={formatDelta(brief.metrics.windowDaily.googleClicks, brief.metrics.priorWindowDaily.googleClicks).label} />
          <MetricCard label="Google impressions (28d)" value={formatInt(brief.metrics.windowDaily.googleImpressions)} helper={formatDelta(brief.metrics.windowDaily.googleImpressions, brief.metrics.priorWindowDaily.googleImpressions).label} />
        </div>
      </Panel>
    </AdminShell>
  );
}
