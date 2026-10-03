import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { MetricCard, Panel, SectionHeader, StatusBadge } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { getChange, getChangePerformance } from '@/server/changes/engine';
import { formatDelta, formatInt } from '@/lib/format';
import { updateChangeStatusAction } from '../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Params { params: Promise<{ id: string }> }

export default async function ChangeDetailPage({ params }: Params) {
  const { admin, sb } = await requireAdmin('/admin/seo/changes');
  const sites = await listNetworkSites(sb);
  const { id } = await params;
  const change = await getChange(sb, id);
  if (!change) notFound();
  const perf = await getChangePerformance(sb, id);
  const site = sites.find((s) => s.id === change.site_id);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug={site?.slug ?? 'network'} pathname={`/admin/seo/changes/${id}`}>
      <SectionHeader
        eyebrow={`SEO · Change · ${site?.shortName ?? ''}`}
        title={change.title}
        description={`${change.change_type.replace(/_/g, ' ')} · recorded ${new Date(change.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC by ${change.actor ?? 'unknown'}.`}
        actions={<Link href="/admin/seo/changes" className="status-badge status-not_connected">← All changes</Link>}
      />

      <Panel title="Status" eyebrow="State">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <StatusBadge state={change.status === 'deployed' ? 'active' : change.status === 'completed' ? 'success' : change.status === 'rolled_back' ? 'failed' : 'info'} label={change.status.replace(/_/g, ' ')} />
          {change.deployed_at && <span style={{ fontSize: 12 }} className="col-dim">deployed {new Date(change.deployed_at).toISOString().slice(0, 10)}</span>}
          {change.measurement_start && <span style={{ fontSize: 12 }} className="col-dim">measurement from {change.measurement_start}</span>}
          {change.commit_sha && <code style={{ fontSize: 11 }}>{change.commit_sha.slice(0, 10)}</code>}
          <form style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {['proposed', 'deployed', 'measuring', 'completed', 'rolled_back', 'cancelled'].map((s) => (
              <button
                key={s}
                type="submit"
                formAction={async () => { 'use server'; await updateChangeStatusAction(id, s); }}
                className={`status-badge ${change.status === s ? 'status-active' : 'status-not_connected'}`}
                style={{ cursor: 'pointer', border: 'none', fontSize: 11 }}
              >
                {s.replace(/_/g, ' ')}
              </button>
            ))}
          </form>
        </div>
      </Panel>

      <Panel title="Observed before/after performance" eyebrow="Measurement">
        <p className="admin-section-desc" style={{ marginTop: 0 }}>
          GSC + GA4 totals for the targeted URL / pattern, split by the measurement_start date. Labelled "observed" — we do NOT claim causation.
        </p>
        {!change.measurement_start ? (
          <div style={{ padding: 12, border: '1px solid #E6E6E6', borderRadius: 6, fontSize: 13 }} className="col-dim">
            Measurement starts once this change is marked <code>deployed</code>.
          </div>
        ) : (
          <div className="metric-grid">
            <MetricCard
              label="Clicks (before)"
              value={perf.before ? formatInt(perf.before.clicks) : '0'}
              state={perf.before ? 'ok' : 'muted'}
              helper={perf.before ? `${perf.before.windowStart} → ${perf.before.windowEnd}` : undefined}
            />
            <MetricCard
              label="Clicks (after)"
              value={perf.after ? formatInt(perf.after.clicks) : '0'}
              state={perf.after ? 'ok' : 'muted'}
              helper={perf.before && perf.after ? formatDelta(perf.after.clicks, perf.before.clicks).label : undefined}
            />
            <MetricCard
              label="Impressions (before)"
              value={perf.before ? formatInt(perf.before.impressions) : '0'}
              state={perf.before ? 'ok' : 'muted'}
            />
            <MetricCard
              label="Impressions (after)"
              value={perf.after ? formatInt(perf.after.impressions) : '0'}
              state={perf.after ? 'ok' : 'muted'}
              helper={perf.before && perf.after ? formatDelta(perf.after.impressions, perf.before.impressions).label : undefined}
            />
            <MetricCard
              label="Position (before)"
              value={perf.before?.position != null ? perf.before.position.toFixed(1) : '—'}
              state={perf.before?.position != null ? 'ok' : 'muted'}
            />
            <MetricCard
              label="Position (after)"
              value={perf.after?.position != null ? perf.after.position.toFixed(1) : '—'}
              state={perf.after?.position != null ? 'ok' : 'muted'}
            />
            <MetricCard
              label="GA4 users (before)"
              value={perf.before ? formatInt(perf.before.ga4Users) : '0'}
              state={perf.before ? 'ok' : 'muted'}
            />
            <MetricCard
              label="GA4 users (after)"
              value={perf.after ? formatInt(perf.after.ga4Users) : '0'}
              state={perf.after ? 'ok' : 'muted'}
              helper={perf.before && perf.after ? formatDelta(perf.after.ga4Users, perf.before.ga4Users).label : undefined}
            />
          </div>
        )}
      </Panel>

      {(change.old_value || change.new_value) && (
        <Panel title="Old → new" eyebrow="Diff">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <pre style={{ background: '#FAFAFA', padding: 12, borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{change.old_value ?? '—'}</pre>
            <pre style={{ background: '#F3F8FA', padding: 12, borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{change.new_value ?? '—'}</pre>
          </div>
        </Panel>
      )}

      {change.description && (
        <Panel title="Description" eyebrow="Notes">
          <p style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{change.description}</p>
        </Panel>
      )}
    </AdminShell>
  );
}
