import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { HOLD_REASON_LABELS, listHolds } from '@/server/autopilot/holds';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AutopilotHoldsPage() {
  const { admin, sb } = await requireAdmin('/admin/content/holds');
  const sites = await listNetworkSites(sb);
  const { rows, summary } = await listHolds(sb, 100);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/content/holds">
      <SectionHeader
        eyebrow="Content · Holds"
        title="Autopilot holds"
        description={<>Opportunities and generated articles that automation decided NOT to publish, with a plain-English reason and recommended resolution for each. Nothing on this page auto-triggers paid work.</>}
        actions={<Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/content/autopilot">Autopilot settings</Link>}
      />

      {rows.length === 0 ? (
        <Notice tone="success">
          <strong>No holds.</strong> Nothing has been held by the autopilot pipeline. This is expected during Checkpoint A because no runs have taken place yet.
        </Notice>
      ) : (
        <Notice tone="warning">
          <strong>{summary.total}</strong> item(s) held. Review each one and either flip a setting / fix the data / dismiss manually.
        </Notice>
      )}

      {summary.total > 0 && (
        <Panel title="By reason" eyebrow="Count of holds grouped by stable reason token">
          <Table
            columns={[
              { key: 'r', header: 'Reason',       render: (r: ReasonRow) => <code>{r.reason}</code> },
              { key: 't', header: 'Title',        render: (r: ReasonRow) => <strong>{r.title}</strong> },
              { key: 'c', header: 'Count',        className: 'num', render: (r: ReasonRow) => String(r.count) },
              { key: 'd', header: 'What it means',render: (r: ReasonRow) => <span style={{ fontSize: 12.5 }}>{r.detail}</span> },
            ]}
            rows={Object.entries(summary.by_reason).map(([reason, count]) => ({
              id: reason,
              reason,
              count,
              title: HOLD_REASON_LABELS[reason]?.title ?? reason,
              detail: HOLD_REASON_LABELS[reason]?.detail ?? 'No description available for this reason token.',
            }))}
            empty=""
          />
        </Panel>
      )}

      <Panel title={`Held items${rows.length > 0 ? ` (${rows.length} shown)` : ''}`} eyebrow="Newest first">
        <Table
          columns={[
            { key: 'when',  header: 'When held', render: (r) => <code style={{ fontSize: 11 }}>{r.held_at ?? '—'}</code> },
            { key: 'kind',  header: 'Kind',      render: (r) => r.kind === 'article'
              ? <StatusBadge state="warning" label="article" />
              : <StatusBadge state="info" label="opportunity" /> },
            { key: 'site',  header: 'Site',      render: (r) => r.site_name
              ? <span><strong>{r.site_name}</strong> <code className="col-dim" style={{ fontSize: 11 }}>{r.site_slug}</code></span>
              : <span className="col-dim">Network</span> },
            { key: 'topic', header: 'Topic',     render: (r) => <span style={{ fontSize: 13 }}>{r.topic}</span> },
            { key: 'type',  header: 'Content type', render: (r) => <code style={{ fontSize: 11 }}>{r.content_type ?? '—'}</code> },
            { key: 'score', header: 'Score',     className: 'num', render: (r) => r.score != null ? r.score.toFixed(1) : <span className="col-dim">—</span> },
            { key: 'est',   header: 'Est. cost (USD)', className: 'num', render: (r) =>
              r.budget_cents_estimate != null ? `$${(r.budget_cents_estimate / 100).toFixed(3)}` :
              <span className="col-dim">—</span> },
            { key: 'act',   header: 'Actual cost (USD)', className: 'num', render: (r) =>
              r.budget_cents_actual != null ? `$${(r.budget_cents_actual / 100).toFixed(3)}` :
              <span className="col-dim">—</span> },
            { key: 'reason',header: 'Reasons',   render: (r) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {r.hold_reasons.map((token) => (
                  <span key={token} style={{ fontSize: 11 }}>
                    <code>{token}</code>{' '}
                    <span className="col-dim">· {HOLD_REASON_LABELS[token]?.title ?? '(unknown reason)'}</span>
                  </span>
                ))}
              </div>
            ) },
            { key: 'res',   header: 'Resolution', render: (r) => <span style={{ fontSize: 12 }}>{r.resolution_hint}</span> },
          ]}
          rows={rows.map((r) => ({ ...r, id: `${r.kind}:${r.id}` }))}
          empty={<span className="col-dim">Nothing held.</span>}
        />
      </Panel>

      <Panel title="Reason reference" eyebrow="Every token the pipeline can set">
        <Table
          columns={[
            { key: 'r', header: 'Token',   render: (r: ReasonRow) => <code>{r.reason}</code> },
            { key: 't', header: 'Label',   render: (r: ReasonRow) => <strong>{r.title}</strong> },
            { key: 'd', header: 'Detail',  render: (r: ReasonRow) => <span style={{ fontSize: 12.5 }}>{r.detail}</span> },
            { key: 'x', header: 'Resolution', render: (r: ReasonRow) => <span style={{ fontSize: 12.5 }}>{r.resolution}</span> },
          ]}
          rows={Object.entries(HOLD_REASON_LABELS).map(([reason, meta]) => ({
            id: reason,
            reason,
            title: meta.title,
            detail: meta.detail,
            resolution: meta.resolution,
            count: 0,
          }))}
          empty=""
        />
      </Panel>
    </AdminShell>
  );
}

interface ReasonRow { id: string; reason: string; title: string; detail: string; resolution?: string; count: number }
