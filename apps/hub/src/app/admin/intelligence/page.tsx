import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listIntelligenceInbox, type IntelligenceRowRead } from '@/server/intelligence/queries';
import { PRIORITY_FORMULA_LABEL, priorityBand } from '@/server/intelligence/scoring';
import type { IntelligenceCategory, IntelligenceStatus, SiteSlug } from '@/server/intelligence/types';
import {
  createTaskFromItemAction, snoozeItemAction, dismissItemAction, resolveItemAction, refreshIntelligenceAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SITE_FILTERS: Array<{ label: string; value: '' | 'network' | SiteSlug }> = [
  { label: 'All sites',       value: '' },
  { label: 'Network-wide',    value: 'network' },
  { label: 'Pokemon',         value: 'pokemon' },
  { label: 'MTG',             value: 'mtg' },
  { label: 'YGO',             value: 'ygo' },
  { label: 'One Piece',       value: 'onepiece' },
  { label: 'Lorcana',         value: 'lorcana' },
];

const CATEGORY_FILTERS: Array<{ label: string; value: '' | IntelligenceCategory }> = [
  { label: 'All categories', value: '' },
  { label: 'SEO',           value: 'seo' },
  { label: 'Content',       value: 'content' },
  { label: 'Revenue',       value: 'revenue' },
  { label: 'Monetisation',  value: 'monetisation' },
  { label: 'Technical',     value: 'technical' },
  { label: 'Data health',   value: 'data_health' },
  { label: 'Indexing',      value: 'indexing' },
  { label: 'Growth',        value: 'growth' },
];

interface PageProps {
  searchParams?: Promise<{ site?: string; category?: string; status?: string }>;
}

export default async function AdminIntelligencePage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/intelligence');
  const sites = await listNetworkSites(sb);
  const params = (await searchParams) ?? {};

  const siteParam     = params.site ?? '';
  const categoryParam = (params.category ?? '') as '' | IntelligenceCategory;
  const statusParam   = (params.status ?? 'active') as 'active' | 'resolved' | 'dismissed' | 'snoozed';

  const statusesByView: Record<string, IntelligenceStatus[]> = {
    active:    ['open', 'task_created'],
    snoozed:   ['snoozed'],
    resolved:  ['resolved'],
    dismissed: ['dismissed'],
  };

  const site_slug: SiteSlug | null | undefined =
    siteParam === '' ? undefined :
    siteParam === 'network' ? null :
    (siteParam as SiteSlug);

  const { rows, summary, error: queryError } = await listIntelligenceInbox(sb, {
    site_slug,
    category: categoryParam || null,
    statuses: statusesByView[statusParam] ?? statusesByView['active']!,
    limit: 200,
  });

  const headline = summary.total === 0
    ? statusParam === 'active' ? 'Nothing worth your attention right now.' : `No ${statusParam} items.`
    : `${summary.total} thing${summary.total === 1 ? '' : 's'} worth your attention.`;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/intelligence">
      <SectionHeader
        eyebrow="Collector Network OS · Intelligence"
        title="Intelligence inbox"
        description={<>Deterministic ranked view of the highest-value signals across all five sites. Scores come from the engine, not an LLM. {headline}</>}
        actions={
          <form action={refreshIntelligenceAction}>
            <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">Refresh now</button>
          </form>
        }
      />

      <Panel title="Overview" eyebrow={`Formula · ${PRIORITY_FORMULA_LABEL}`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <SummaryKV label="Critical" value={summary.critical.toString()} tone={summary.critical > 0 ? 'warning' : 'muted'} />
          <SummaryKV label="High" value={summary.high.toString()} tone={summary.high > 0 ? 'warning' : 'muted'} />
          <SummaryKV label="Opportunities" value={summary.opportunities.toString()} tone="success" />
          <SummaryKV label="Risks + warnings" value={summary.risks.toString()} tone={summary.risks > 0 ? 'warning' : 'muted'} />
          <SummaryKV label="Tasks created" value={summary.tasks_created.toString()} tone="muted" />
          <SummaryKV label="Total shown" value={summary.total.toString()} tone="muted" />
        </div>
      </Panel>

      {/* ─── Filters ─── */}
      <Panel title="Filters" eyebrow="GET params; shareable">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <FilterGroup label="Site">
            {SITE_FILTERS.map((f) => (
              <FilterLink key={f.value} href={buildHref(params, { site: f.value, category: categoryParam, status: statusParam })} active={siteParam === f.value}>
                {f.label}
              </FilterLink>
            ))}
          </FilterGroup>
          <FilterGroup label="Category">
            {CATEGORY_FILTERS.map((f) => (
              <FilterLink key={f.value} href={buildHref(params, { site: siteParam, category: f.value, status: statusParam })} active={categoryParam === f.value}>
                {f.label}
              </FilterLink>
            ))}
          </FilterGroup>
          <FilterGroup label="Status">
            {(['active', 'snoozed', 'resolved', 'dismissed'] as const).map((v) => (
              <FilterLink key={v} href={buildHref(params, { site: siteParam, category: categoryParam, status: v })} active={statusParam === v}>
                {v}
              </FilterLink>
            ))}
          </FilterGroup>
        </div>
      </Panel>

      {queryError && (
        <Notice tone="warning">
          <strong>Could not load intelligence items.</strong>{' '}
          Error: <code>{queryError}</code>. The admin shell has been kept online. Refresh in a few seconds (PostgREST
          schema caches reload after column/enum renames) or inspect the Supabase logs.
        </Notice>
      )}

      {!queryError && rows.length === 0 && (
        <Notice tone="info">
          {statusParam === 'active'
            ? <>No intelligence items yet. Click <strong>Refresh now</strong> at the top to generate the first batch, or wait for the scheduled run.</>
            : <>No items for the current filters. Try widening the site/category filters.</>}
        </Notice>
      )}

      {rows.map((row, i) => (
        <IntelligenceCard key={row.id} rank={i + 1} row={row} />
      ))}
    </AdminShell>
  );
}

function IntelligenceCard({ rank, row }: { rank: number; row: IntelligenceRowRead }) {
  const band = priorityBand(row.priority_score ?? 0);
  const signalBadge = row.signal_kind === 'opportunity' ? 'info'
                   : row.signal_kind === 'positive'    ? 'success'
                   : row.signal_kind === 'risk'        ? 'failed'
                   : row.signal_kind === 'warning'     ? 'warning'
                   :                                      'disabled';
  const siteLabel = row.network_sites?.slug ?? 'network';
  // expected_upside is jsonb — defend against unexpected shapes
  // (e.g. a string or array sneaking in from a legacy row).
  const upside: { label?: string; rationale?: string } | null =
    row.expected_upside && typeof row.expected_upside === 'object' && !Array.isArray(row.expected_upside)
      ? (row.expected_upside as { label?: string; rationale?: string })
      : null;
  const upsideLabel     = typeof upside?.label === 'string' ? upside.label : null;
  const upsideRationale = typeof upside?.rationale === 'string' ? upside.rationale : null;
  return (
    <Panel
      title={`#${rank} · ${siteLabel} · ${row.title}`}
      eyebrow={`${row.category.toUpperCase()} · ${row.type}`}
      actions={<PriorityPill band={band} value={row.priority_score} />}
    >
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <StatusBadge state={signalBadge} label={row.signal_kind ?? 'unknown'} />
        {row.status === 'task_created' && <StatusBadge state="success" label={`task · ${row.task_id?.slice(0, 8) ?? ''}`} />}
        {row.status === 'snoozed' && row.snoozed_until && (
          <StatusBadge state="warning" label={`snoozed until ${safeDate(row.snoozed_until)}`} />
        )}
      </div>

      <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: '0 0 8px' }}>{row.summary || '(no summary)'}</p>
      <p style={{ fontSize: 13, lineHeight: 1.55, margin: '0 0 10px', color: 'var(--admin-text-muted)' }}>
        <strong>Recommendation:</strong> {row.recommended_action || '(no recommendation)'}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 10 }}>
        <ScoreKV label="Impact" value={row.impact_score ?? 0} />
        <ScoreKV label="Confidence" value={row.confidence_score ?? 0} />
        <ScoreKV label="Urgency" value={row.urgency_score ?? 0} />
        <ScoreKV label="Effort" value={row.effort_score ?? 0} />
      </div>

      {upsideLabel && (
        <p style={{ fontSize: 12.5, margin: '0 0 10px', color: 'var(--admin-text-muted)' }}>
          <strong>Potential:</strong> {upsideLabel}
          {upsideRationale && <> <span className="col-dim">({upsideRationale})</span></>}
        </p>
      )}

      {row.status === 'open' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          <form action={createTaskFromItemAction}><input type="hidden" name="item_id" value={row.id} /><button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">Create task</button></form>
          <SnoozeMenu id={row.id} />
          <form action={dismissItemAction}><input type="hidden" name="item_id" value={row.id} /><button type="submit" className="ui-btn ui-btn--secondary ui-btn--sm">Dismiss</button></form>
          <form action={resolveItemAction}><input type="hidden" name="item_id" value={row.id} /><button type="submit" className="ui-btn ui-btn--secondary ui-btn--sm">Resolve</button></form>
        </div>
      )}
      {row.status === 'task_created' && row.task_id && (
        <div style={{ fontSize: 12.5, marginTop: 8 }}>
          Task created · <Link href={`/admin/tasks?open=${row.task_id}`}><code>{row.task_id.slice(0, 12)}…</code></Link>
          <> · </>
          <form action={resolveItemAction} style={{ display: 'inline' }}>
            <input type="hidden" name="item_id" value={row.id} />
            <button type="submit" className="ui-btn ui-btn--secondary ui-btn--sm">Mark resolved</button>
          </form>
        </div>
      )}

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Evidence + score breakdown + source</summary>
        <div style={{ marginTop: 8 }}>
          <h4 className="admin-eyebrow" style={{ marginBottom: 4 }}>Evidence</h4>
          <pre style={{ background: 'var(--admin-surface-strong)', padding: 10, borderRadius: 6, fontSize: 11, maxHeight: 260, overflow: 'auto' }}>
            {safeStringify(row.evidence)}
          </pre>
          <h4 className="admin-eyebrow" style={{ marginTop: 10, marginBottom: 4 }}>Source</h4>
          <div style={{ fontSize: 12 }}>
            <div><strong>source_type:</strong> <code>{row.source_type}</code></div>
            <div><strong>source_id:</strong> <code>{row.source_id ?? '—'}</code></div>
            <div><strong>source_key:</strong> <code>{row.source_key}</code></div>
            <div><strong>first_detected_at:</strong> <code>{row.first_detected_at}</code></div>
            <div><strong>last_detected_at:</strong> <code>{row.last_detected_at}</code></div>
          </div>
        </div>
      </details>
    </Panel>
  );
}

function SnoozeMenu({ id }: { id: string }) {
  return (
    <details style={{ display: 'inline-block' }}>
      <summary className="ui-btn ui-btn--secondary ui-btn--sm" style={{ cursor: 'pointer' }}>Snooze…</summary>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {[1, 7, 30].map((days) => (
          <form key={days} action={snoozeItemAction}>
            <input type="hidden" name="item_id" value={id} />
            <input type="hidden" name="days" value={days} />
            <button type="submit" className="ui-btn ui-btn--secondary ui-btn--sm">{days}d</button>
          </form>
        ))}
      </div>
    </details>
  );
}

function PriorityPill({ band, value }: { band: 'critical' | 'high' | 'normal' | 'low'; value: number }) {
  const color =
    band === 'critical' ? 'var(--failed, #c0392b)' :
    band === 'high'     ? 'var(--warning, #e67e22)' :
    band === 'normal'   ? 'var(--admin-accent, #4a90e2)' :
                          'var(--admin-text-muted, #6b7280)';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 6,
      padding: '4px 10px', borderRadius: 999,
      border: `1px solid ${color}`, color,
      fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
    }}>
      <span style={{ textTransform: 'uppercase' }}>{band}</span>
      <span style={{ fontSize: 14 }}>{value}</span>
    </div>
  );
}

function ScoreKV({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      border: '1px solid var(--admin-border)',
      borderRadius: 'var(--radius-md)',
      padding: '6px 10px',
      background: 'var(--admin-surface)',
    }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-subtle)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function SummaryKV({ label, value, tone }: { label: string; value: string; tone: 'muted' | 'success' | 'warning' }) {
  const bg = tone === 'success' ? 'var(--success-soft, #e6f7ec)' : tone === 'warning' ? 'var(--warning-soft, #fff3e0)' : 'var(--admin-surface)';
  const fg = tone === 'success' ? 'var(--success, #2a9f58)' : tone === 'warning' ? 'var(--warning, #e67e22)' : 'var(--admin-text)';
  return (
    <div style={{
      border: '1px solid var(--admin-border)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      background: bg,
    }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-subtle)', fontWeight: 700, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: fg }}>{value}</div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="admin-eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{children}</div>
    </div>
  );
}
function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-block', padding: '4px 10px', borderRadius: 999, fontSize: 12,
        border: `1px solid ${active ? 'var(--admin-accent, #4a90e2)' : 'var(--admin-border)'}`,
        background: active ? 'var(--admin-accent, #4a90e2)' : 'transparent',
        color: active ? '#fff' : 'var(--admin-text)',
        textDecoration: 'none',
      }}
    >{children}</Link>
  );
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v ?? {}, null, 2); } catch { return '{}'; }
}

function safeDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function buildHref(current: Record<string, string | undefined>, next: { site: string; category: string; status: string }): string {
  const sp = new URLSearchParams();
  if (next.site) sp.set('site', next.site);
  if (next.category) sp.set('category', next.category);
  if (next.status && next.status !== 'active') sp.set('status', next.status);
  void current;
  const qs = sp.toString();
  return qs ? `/admin/intelligence?${qs}` : `/admin/intelligence`;
}
