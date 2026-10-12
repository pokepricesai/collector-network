import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge } from '@/components/admin/admin-ui';
import { EmptyPanelNotice } from '@/components/admin/EmptyPanelNotice';
import { FreshnessBadge, freshnessState } from '@/components/admin/FreshnessBadge';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { buildMorningBrief, type AttentionItem, type MorningBrief, type SeoOpportunity, type SiteSnapshot } from '@/server/brief/morning';
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
        description={
          <>
            {brief.day_label} ·{' '}
            <NetworkStatusChip status={brief.network_status} />{' '}
            <span style={{ color: 'var(--admin-text-muted)' }}>{brief.status_headline}.</span>
          </>
        }
      />

      {/* ─── What matters today ─────────────────────────────── */}
      <Panel
        title="What matters today"
        actions={<Link href="/admin/intelligence" className="ui-btn ui-btn--secondary ui-btn--sm">All Intelligence</Link>}
      >
        {brief.attention_items.length === 0 ? (
          <EmptyPanelNotice>Nothing worth your attention right now.</EmptyPanelNotice>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {brief.attention_items.map((it) => <AttentionRow key={it.id} item={it} />)}
          </ul>
        )}
      </Panel>

      {/* ─── My tasks ────────────────────────────────────────── */}
      <Panel
        title="My tasks"
        eyebrow={`${brief.tasks.total_open} open · operator inbox`}
        actions={<Link href="/admin/tasks" className="ui-btn ui-btn--secondary ui-btn--sm">View all</Link>}
      >
        {brief.tasks.total_open === 0 ? (
          <EmptyPanelNotice>
            Nothing on your personal queue. Press <strong>+ Task</strong> at the top-right to jot something down.
          </EmptyPanelNotice>
        ) : (
          <>
            {brief.tasks.high.length > 0 && (
              <>
                <h4 className="admin-eyebrow" style={{ margin: '0 0 6px', fontSize: 11 }}>Today · high priority</h4>
                <ul style={{ listStyle: 'none', margin: '0 0 12px', padding: 0 }}>
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
      <Panel title="Network snapshot" eyebrow="Five sites · 28 days">
        <div style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        }}>
          {brief.sites.map((s) => <SiteCard key={s.slug} site={s} siteAttributionAvailable={brief.revenue.site_attribution_available} />)}
        </div>
        {!brief.revenue.site_attribution_available && (
          <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--admin-text-muted)' }}>
            Site revenue attribution unavailable — EPN events are not yet tagged with site_id. Network GBP revenue appears in the Revenue panel below.
          </div>
        )}
      </Panel>

      {/* ─── Growth + Revenue ─────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Panel title="Growth &amp; Momentum" eyebrow="Deterministic signals">
          {brief.growth.length === 0 ? (
            <EmptyPanelNotice>No growth or positive signals in the current Intelligence set.</EmptyPanelNotice>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {brief.growth.map((g, i) => (
                <li key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--admin-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <StatusBadge state={g.signal_kind === 'positive' ? 'success' : 'info'} label={g.site_display} />
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{g.title.replace(/^📈\s*/, '').replace(/^📉\s*/, '')}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--admin-text-muted)', marginTop: 2 }}>{g.summary}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Revenue" eyebrow="28 days · currencies kept separate">
          {brief.revenue.availability === 'unavailable' ? (
            <EmptyPanelNotice>{brief.revenue.note}</EmptyPanelNotice>
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

      {/* ─── Content + SEO Lab ──────────────────────────────── */}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <Panel title="Content engine" eyebrow="Status only — no AI from here">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8 }}>
            <ContentMetric label="Published 7d" value={brief.content.published_last_7d} />
            <ContentMetric label="Scheduled"    value={brief.content.scheduled} />
            <ContentMetric label="In review"    value={brief.content.review} />
            <ContentMetric label="Hi-value ideas" value={brief.content.high_value_ideas} />
            <ContentMetric label="Blocked / held" value={brief.content.blocked_or_held} />
          </div>
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--admin-text-muted)', lineHeight: 1.5 }}>
            {brief.content.in_review_title && <div><strong>In review:</strong> {brief.content.in_review_title}</div>}
            {brief.content.next_scheduled_title && <div><strong>Next scheduled:</strong> {brief.content.next_scheduled_title}</div>}
            {brief.content.last_published_label && <div><strong>Last published:</strong> {brief.content.last_published_label}</div>}
            {!brief.content.in_review_title && !brief.content.next_scheduled_title && !brief.content.last_published_label && (
              <div>No articles scheduled.</div>
            )}
          </div>
        </Panel>

        <Panel title="SEO Lab" eyebrow="Top page-level opportunities" actions={<Link href="/admin/intelligence" className="ui-btn ui-btn--secondary ui-btn--sm">All Intelligence</Link>}>
          {brief.seo.length === 0 ? (
            <EmptyPanelNotice>No SEO opportunities above threshold right now.</EmptyPanelNotice>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {brief.seo.map((s) => <SeoRow key={s.key} opp={s} />)}
            </ul>
          )}
        </Panel>
      </div>

      {/* ─── Health ─────────────────────────────────────────── */}
      <Panel title="Health" eyebrow={brief.health.all_healthy ? 'All core systems healthy' : 'Needs attention'}>
        {brief.health.all_healthy ? (
          <EmptyPanelNotice>All core systems healthy. No open indexing or data-health issues.</EmptyPanelNotice>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, marginBottom: 4 }}>
              {brief.health.sitemap_error_count > 0 && (
                <Link href="/admin/seo/sitemaps" style={{ color: 'var(--failed, #c0392b)', fontWeight: 600, textDecoration: 'none' }}>
                  {brief.health.sitemap_error_count} sitemap error{brief.health.sitemap_error_count === 1 ? '' : 's'} →
                </Link>
              )}
              {brief.health.failed_core_jobs > 0 && (
                <Link href="/admin/jobs" style={{ color: 'var(--failed, #c0392b)', fontWeight: 600, textDecoration: 'none' }}>
                  {brief.health.failed_core_jobs} failing job{brief.health.failed_core_jobs === 1 ? '' : 's'} →
                </Link>
              )}
              {brief.health.network_stale_crons > 0 && (
                <Link href="/admin/jobs" style={{ color: 'var(--warning, #e67e22)', fontWeight: 600, textDecoration: 'none' }}>
                  {brief.health.network_stale_crons} network cron stall{brief.health.network_stale_crons === 1 ? '' : 's'} →
                </Link>
              )}
              {brief.health.stale_core_jobs > 0 && (
                <Link href="/admin/jobs" style={{ color: 'var(--warning, #e67e22)', fontWeight: 600, textDecoration: 'none' }}>
                  {brief.health.stale_core_jobs} stale core job{brief.health.stale_core_jobs === 1 ? '' : 's'} →
                </Link>
              )}
              {brief.health.other_warnings > 0 && (
                <span style={{ color: 'var(--admin-text-muted)' }}>
                  +{brief.health.other_warnings} other warning{brief.health.other_warnings === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--admin-text-muted)' }}>
              Details appear in <Link href="/admin/intelligence">Intelligence</Link> and <Link href="/admin/health">Health</Link>.
            </div>
          </>
        )}
      </Panel>

      {/* ─── Freshness footer ────────────────────────────────── */}
      <Panel title="Data freshness" eyebrow="Sources backing this brief">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {brief.freshness.map((f) => {
            const thresholds =
              f.source === 'Intelligence' ? { freshHours: 26, agingHours: 36 }
              : f.source === 'Revenue'    ? { freshHours: 48, agingHours: 120 }
              : f.source === 'GSC'        ? { freshHours: 72, agingHours: 120 }
              : f.source === 'GA4'        ? { freshHours: 48, agingHours: 96 }
              :                             { freshHours: 7 * 24, agingHours: 14 * 24 };
            const state = freshnessState(f.through, thresholds);
            return (
              <div key={f.source} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="admin-eyebrow" style={{ fontSize: 10 }}>{f.source}</span>
                <FreshnessBadge state={state} label={f.freshness_label} />
              </div>
            );
          })}
        </div>
      </Panel>
    </AdminShell>
  );
}

function NetworkStatusChip({ status }: { status: MorningBrief['network_status'] }) {
  const label  = status === 'action_required' ? 'ACTION REQUIRED'
             : status === 'needs_attention' ? 'NEEDS ATTENTION'
             : 'HEALTHY';
  const state  = status === 'action_required' ? 'failed'
             : status === 'needs_attention' ? 'warning'
             : 'success';
  return <StatusBadge state={state} label={label} />;
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const badge  = item.signal_kind === 'risk'       ? 'failed'
             : item.signal_kind === 'warning'      ? 'warning'
             : item.signal_kind === 'opportunity'  ? 'opportunity'
             : item.signal_kind === 'positive'     ? 'success'
             : 'info';
  return (
    <li style={{
      padding: '10px 0',
      borderBottom: '1px solid var(--admin-border)',
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: 10,
      alignItems: 'start',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <StatusBadge state={badge} label={item.site_display} />
          <StatusBadge state="info" label={item.type_label} />
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{item.title}</span>
          <span className="col-dim" style={{ fontSize: 11 }}>priority {item.priority_score}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--admin-text-muted)', marginTop: 4, lineHeight: 1.45 }}>
          {item.summary}
        </div>
        {item.recommended_action && (
          <div style={{ fontSize: 12, marginTop: 4 }}>
            <strong>Action:</strong> {item.recommended_action}
          </div>
        )}
        {item.expected_upside_label && (
          <div style={{ fontSize: 12, color: 'var(--admin-text-muted)', marginTop: 2 }}>
            <strong>Potential:</strong> {item.expected_upside_label}
          </div>
        )}
      </div>
      <Link href={item.action_hint.href} className="ui-btn ui-btn--secondary ui-btn--sm" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
        {item.action_hint.label}
      </Link>
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
        <div style={{ display: 'flex', gap: 6, marginTop: 2, fontSize: 11, color: 'var(--admin-text-muted)', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <StatusBadge state={kindBadge} label={task.task_kind} />
          <StatusBadge state={sourceBadge} label={task.task_source} />
          {(task.priority === 'critical' || task.priority === 'high') && <StatusBadge state="warning" label={task.priority} />}
          <span>{task.site_display}</span>
        </div>
      </div>
      <Link href="/admin/tasks" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ fontSize: 11 }}>Open</Link>
    </li>
  );
}

function SiteCard({ site, siteAttributionAvailable }: { site: SiteSnapshot; siteAttributionAvailable: boolean }) {
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
      padding: 10,
      background: 'var(--admin-surface)',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <Link href={`/admin/sites/${site.slug}`} style={{ fontSize: 13.5, fontWeight: 700, textDecoration: 'none', color: 'inherit' }}>{site.name}</Link>
        <StatusBadge state={statusBadge} label={statusLabel} />
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--admin-text-muted)' }}>
        <span style={{ color: 'var(--admin-text)', fontWeight: 600 }}>{site.reporting_active_users_28d.toLocaleString()}</span> user-days · {site.change_pct_label}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--admin-text-muted)' }}>
        <span style={{ color: 'var(--admin-text)', fontWeight: 600 }}>{site.gsc_clicks_28d.toLocaleString()}</span> clicks · {site.gsc_impressions_28d.toLocaleString()} impr
      </div>
      {siteAttributionAvailable && (
        <div style={{ fontSize: 11.5, color: 'var(--admin-text-muted)' }}>
          Revenue: {site.revenue_minor_28d == null
            ? <em>no data</em>
            : <strong style={{ color: 'var(--admin-text)' }}>{formatMoneyMinor(site.revenue_minor_28d, site.revenue_currency ?? 'GBP')}</strong>}
        </div>
      )}
      {(site.open_risk_count + site.open_warning_count) > 0 && (
        <div style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>
          {site.open_risk_count > 0 && <>{site.open_risk_count} risk</>}
          {site.open_risk_count > 0 && site.open_warning_count > 0 && ' · '}
          {site.open_warning_count > 0 && <>{site.open_warning_count} warning</>}
        </div>
      )}
      <div style={{ fontSize: 10.5, color: 'var(--admin-text-subtle)', fontStyle: 'italic', marginTop: 2 }}>{site.status_reason}</div>
    </div>
  );
}

function SeoRow({ opp }: { opp: SeoOpportunity }) {
  return (
    <li style={{ padding: '8px 0', borderBottom: '1px solid var(--admin-border)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <StatusBadge state="opportunity" label={opp.site_display} />
        <StatusBadge state="info" label={opp.type_label} />
        <span style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>priority {opp.priority_score}</span>
      </div>
      <div style={{ fontSize: 12.5, marginTop: 4, fontFamily: 'ui-monospace, monospace', color: 'var(--admin-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {opp.page_label}
      </div>
      <div style={{ fontSize: 12, color: 'var(--admin-text-muted)', marginTop: 2 }}>
        {opp.total_impressions.toLocaleString()} impressions
        {opp.weighted_position != null && ` · position ${opp.weighted_position.toFixed(1)}`}
        {opp.query_count > 1 && ` · ${opp.query_count} queries`}
      </div>
      {opp.expected_upside_label && (
        <div style={{ fontSize: 12, color: 'var(--admin-text-muted)', marginTop: 2 }}>
          <strong>Potential:</strong> {opp.expected_upside_label}
        </div>
      )}
    </li>
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
