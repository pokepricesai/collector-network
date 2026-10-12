import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { buildMorningBrief, type AttentionItem, type MorningBrief, type SiteSnapshot } from '@/server/brief/morning';
import { formatMoneyMinor } from '@/lib/format';
import { completeTaskAction } from '@/app/admin/tasks/actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function BriefPage() {
  const { admin, sb } = await requireAdmin('/admin/brief');
  const sites = await listNetworkSites(sb);
  const brief = await buildMorningBrief(sb, sites);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/brief">
      <SectionHeader
        eyebrow="Collector Network OS"
        title="Morning Brief"
        description={<>{brief.day_label} · <NetworkStatusChip status={brief.network_status} /> <span style={{ color: 'var(--admin-text-muted)' }}>{brief.network_status_reason}.</span></>}
      />

      {/* ─── What matters today ─────────────────────────────── */}
      <Panel title="What matters today" eyebrow={`${brief.attention_items.length} item${brief.attention_items.length === 1 ? '' : 's'}`} actions={<Link href="/admin/intelligence" className="ui-btn ui-btn--secondary ui-btn--sm">Open Intelligence</Link>}>
        {brief.attention_items.length === 0 ? (
          <Notice tone="info">Nothing worth your attention right now.</Notice>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {brief.attention_items.map((it) => <AttentionCard key={it.id} item={it} />)}
          </ul>
        )}
      </Panel>

      {/* ─── My tasks ────────────────────────────────────────── */}
      <Panel title="My tasks" eyebrow={`${brief.tasks.total_open} open · operator inbox`} actions={<Link href="/admin/tasks" className="ui-btn ui-btn--secondary ui-btn--sm">View all tasks</Link>}>
        {brief.tasks.total_open === 0 ? (
          <Notice tone="info">Nothing on your personal queue. Press <strong>+ Task</strong> above to log something.</Notice>
        ) : (
          <>
            {brief.tasks.high.length > 0 && (
              <>
                <h4 className="admin-eyebrow" style={{ margin: '0 0 6px', fontSize: 11 }}>Today / high priority</h4>
                <ul style={{ listStyle: 'none', margin: '0 0 14px', padding: 0 }}>
                  {brief.tasks.high.map((t) => <TaskRow key={t.id} task={t} />)}
                </ul>
              </>
            )}
            {brief.tasks.other.length > 0 && (
              <>
                <h4 className="admin-eyebrow" style={{ margin: '0 0 6px', fontSize: 11 }}>Other open</h4>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {brief.tasks.other.map((t) => <TaskRow key={t.id} task={t} />)}
                </ul>
              </>
            )}
          </>
        )}
      </Panel>

      {/* ─── Network snapshot ────────────────────────────────── */}
      <Panel title="Network snapshot" eyebrow="Five sites · 28d">
        <div style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}>
          {brief.sites.map((s) => <SiteCard key={s.slug} site={s} />)}
        </div>
      </Panel>

      {/* ─── Growth + Revenue (two columns on desktop) ───────── */}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Panel title="Growth" eyebrow="Deterministic signals">
          {brief.growth.length === 0 ? (
            <Notice tone="info">No growth signals in the current Intelligence set.</Notice>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {brief.growth.map((g, i) => (
                <li key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--admin-border)' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{g.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--admin-text-muted)', marginTop: 2 }}>{g.summary}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Revenue" eyebrow="28d · never mix currencies">
          {brief.revenue.availability === 'unavailable' ? (
            <Notice tone="info">{brief.revenue.note}</Notice>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <div>
                  <div className="admin-eyebrow" style={{ fontSize: 10 }}>GBP net (28d)</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{formatMoneyMinor(brief.revenue.gbp_net_minor, 'GBP')}</div>
                  <div style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>{brief.revenue.gbp_change_label} vs prior 28d</div>
                </div>
                {brief.revenue.non_gbp.map((n) => (
                  <div key={n.currency}>
                    <div className="admin-eyebrow" style={{ fontSize: 10 }}>{n.currency} net (28d)</div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{formatMoneyMinor(n.net_minor, n.currency)}</div>
                    <div style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>never summed with GBP</div>
                  </div>
                ))}
              </div>
              {brief.revenue.revenue_items.length > 0 && (
                <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
                  {brief.revenue.revenue_items.map((it) => (
                    <li key={it.id} style={{ padding: '6px 0', borderTop: '1px solid var(--admin-border)' }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{it.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>{it.summary}</div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>
      </div>

      {/* ─── Content + SEO Lab (two columns on desktop) ──────── */}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Panel title="Content engine" eyebrow="Status only — no AI from here">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8 }}>
            <ContentMetric label="Published 7d" value={brief.content.published_last_7d} />
            <ContentMetric label="Scheduled"    value={brief.content.scheduled} />
            <ContentMetric label="In review"    value={brief.content.review} />
            <ContentMetric label="Hi-value ideas" value={brief.content.high_value_ideas} />
            <ContentMetric label="Blocked / held" value={brief.content.blocked_or_held} />
          </div>
          {brief.content.recent_titles.length > 0 ? (
            <ul style={{ listStyle: 'disc', margin: '10px 0 0 20px', padding: 0, color: 'var(--admin-text-muted)', fontSize: 12.5 }}>
              {brief.content.recent_titles.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          ) : (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--admin-text-muted)' }}>
              {brief.content.published_last_7d === 0 && brief.content.scheduled === 0 && brief.content.review === 0
                ? 'No articles scheduled.'
                : 'No articles published in the last 7 days.'}
            </div>
          )}
        </Panel>

        <Panel title="SEO Lab" eyebrow="Top page-level opportunities" actions={<Link href="/admin/intelligence" className="ui-btn ui-btn--secondary ui-btn--sm">All Intelligence</Link>}>
          {brief.seo.length === 0 ? (
            <Notice tone="info">No SEO opportunities above threshold right now.</Notice>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {brief.seo.map((it) => (
                <li key={it.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--admin-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <StatusBadge state="opportunity" label={it.type.replace(/_/g, ' ')} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{it.site_slug}</span>
                    <span className="col-dim" style={{ fontSize: 11 }}>priority {it.priority_score}</span>
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>{it.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--admin-text-muted)', marginTop: 2 }}>{it.summary}</div>
                  {it.expected_upside_label && (
                    <div style={{ fontSize: 11.5, color: 'var(--admin-text-muted)', marginTop: 2 }}>
                      <strong>Potential:</strong> {it.expected_upside_label}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ─── Health + Positives (two columns on desktop) ─────── */}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Panel title="Health" eyebrow={brief.health.all_healthy ? 'All core systems healthy' : 'Needs attention'}>
          {brief.health.all_healthy ? (
            <Notice tone="success">All core systems healthy. No open indexing or data-health issues.</Notice>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {brief.health.items.map((it) => (
                <li key={it.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--admin-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <StatusBadge state={it.signal_kind === 'risk' ? 'failed' : 'warning'} label={it.signal_kind} />
                    <strong style={{ fontSize: 13 }}>{it.title}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--admin-text-muted)', marginTop: 4 }}>{it.summary}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Positive signals" eyebrow="Evidence-based only">
          {brief.positives.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>No positive signals above threshold right now.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {brief.positives.map((p) => (
                <li key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--admin-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <StatusBadge state="success" label={p.site_slug} />
                    <strong style={{ fontSize: 13 }}>{p.title}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--admin-text-muted)', marginTop: 4 }}>{p.summary}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ─── Freshness footer ────────────────────────────────── */}
      <Panel title="Data freshness" eyebrow="Sources backing this brief">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12 }}>
          {brief.freshness.map((f) => (
            <div key={f.source} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="admin-eyebrow" style={{ fontSize: 10 }}>{f.source}</span>
              <span style={{ color: f.through ? 'var(--admin-text)' : 'var(--admin-text-muted)' }}>{f.freshness_label}</span>
            </div>
          ))}
        </div>
      </Panel>
    </AdminShell>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function NetworkStatusChip({ status }: { status: MorningBrief['network_status'] }) {
  const label  = status === 'action_required' ? 'Action required'
             : status === 'needs_attention' ? 'Needs attention'
             : 'Healthy';
  const state  = status === 'action_required' ? 'failed'
             : status === 'needs_attention' ? 'warning'
             : 'success';
  return <StatusBadge state={state} label={label} />;
}

function AttentionCard({ item }: { item: AttentionItem }) {
  const badge  = item.signal_kind === 'risk'       ? 'failed'
             : item.signal_kind === 'warning'      ? 'warning'
             : item.signal_kind === 'opportunity'  ? 'opportunity'
             : item.signal_kind === 'positive'     ? 'success'
             : 'info';
  return (
    <li style={{ padding: '12px 0', borderBottom: '1px solid var(--admin-border)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <StatusBadge state={badge} label={item.signal_kind} />
        <strong style={{ fontSize: 13.5 }}>{item.site_slug} · {item.title}</strong>
        <span className="col-dim" style={{ fontSize: 11 }}>priority {item.priority_score} ({item.priority_band})</span>
      </div>
      <div style={{ fontSize: 12.5, marginTop: 4, color: 'var(--admin-text-muted)' }}>{item.summary}</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>
        <strong>Action:</strong> {item.recommended_action}
      </div>
      {item.expected_upside_label && (
        <div style={{ fontSize: 12, marginTop: 2, color: 'var(--admin-text-muted)' }}>
          <strong>Potential:</strong> {item.expected_upside_label}
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        <Link href="/admin/intelligence" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ fontSize: 11 }}>View intelligence</Link>
      </div>
    </li>
  );
}

function TaskRow({ task }: { task: MorningBrief['tasks']['high'][number] }) {
  const kindBadge   = task.task_kind === 'fix' ? 'failed' : 'info';
  const sourceBadge = task.task_source === 'manual' ? 'info'
                   : task.task_source === 'intelligence' ? 'success'
                   : 'disabled';
  return (
    <li style={{
      padding: '8px 0',
      borderBottom: '1px solid var(--admin-border)',
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      gap: 10,
      alignItems: 'center',
    }}>
      <form action={completeTaskAction} style={{ display: 'inline-flex' }}>
        <input type="hidden" name="task_id" value={task.id} />
        <button type="submit" className="ui-btn ui-btn--secondary ui-btn--sm"
          style={{ width: 24, height: 24, padding: 0, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}
          aria-label="Mark complete" title="Mark complete">✓</button>
      </form>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 2, fontSize: 11, color: 'var(--admin-text-muted)', flexWrap: 'wrap' }}>
          <StatusBadge state={kindBadge} label={task.task_kind} />
          <StatusBadge state={sourceBadge} label={task.task_source} />
          {(task.priority === 'critical' || task.priority === 'high') && <StatusBadge state="warning" label={task.priority} />}
          <span>{task.site_slug ?? 'network'}</span>
        </div>
      </div>
      <Link href="/admin/tasks" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ fontSize: 11 }}>Open</Link>
    </li>
  );
}

function SiteCard({ site }: { site: SiteSnapshot }) {
  const statusLabel = site.status === 'healthy' ? 'Healthy'
                   : site.status === 'watch' ? 'Watch'
                   : site.status === 'action_required' ? 'Action required'
                   : 'Insufficient data';
  const statusBadge = site.status === 'healthy' ? 'success'
                   : site.status === 'watch' ? 'warning'
                   : site.status === 'action_required' ? 'failed'
                   : 'disabled';
  return (
    <div style={{
      border: '1px solid var(--admin-border)',
      borderRadius: 'var(--radius-md)',
      padding: 12,
      background: 'var(--admin-surface)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href={`/admin/sites/${site.slug}`} style={{ fontSize: 14, fontWeight: 700, textDecoration: 'none', color: 'inherit' }}>{site.name}</Link>
        <StatusBadge state={statusBadge} label={statusLabel} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--admin-text-muted)' }}>
        <span><strong style={{ color: 'var(--admin-text)' }}>{site.reporting_active_users_28d.toLocaleString()}</strong> user-days</span>
        <span>{site.change_pct_label} vs prior</span>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--admin-text-muted)' }}>
        <span><strong style={{ color: 'var(--admin-text)' }}>{site.gsc_clicks_28d.toLocaleString()}</strong> clicks</span>
        <span>·</span>
        <span>{site.gsc_impressions_28d.toLocaleString()} impr</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>
        Revenue: {site.revenue_minor_28d == null
          ? <em>no data</em>
          : <strong style={{ color: 'var(--admin-text)' }}>{formatMoneyMinor(site.revenue_minor_28d, site.revenue_currency ?? 'GBP')}</strong>}
      </div>
      {(site.open_risk_count + site.open_warning_count) > 0 && (
        <div style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>
          {site.open_risk_count > 0 && <>{site.open_risk_count} risk</>}
          {site.open_risk_count > 0 && site.open_warning_count > 0 && ' · '}
          {site.open_warning_count > 0 && <>{site.open_warning_count} warning</>}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--admin-text-subtle)', fontStyle: 'italic' }}>{site.status_reason}</div>
    </div>
  );
}

function ContentMetric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ padding: 8, border: '1px solid var(--admin-border)', borderRadius: 6, background: 'var(--admin-surface)' }}>
      <div className="admin-eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}
