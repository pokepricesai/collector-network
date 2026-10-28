import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge } from '@/components/admin/admin-ui';
import { EmptyPanelNotice } from '@/components/admin/EmptyPanelNotice';
import { FreshnessBadge, freshnessState, relativeLabel } from '@/components/admin/FreshnessBadge';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listIntelligenceInbox, type IntelligenceRowRead } from '@/server/intelligence/queries';
import { PRIORITY_FORMULA_LABEL, priorityBand } from '@/server/intelligence/scoring';
import type { IntelligenceCategory, IntelligenceStatus, SiteSlug } from '@/server/intelligence/types';
import { intelTypeLabel, siteDisplayName } from '@/lib/display-names';
import {
  snoozeItemAction, dismissItemAction, resolveItemAction, refreshIntelligenceAction,
} from './actions';
import { CreateTaskButton } from './CreateTaskButton';
import { deriveMeasurementState, type MeasurementState } from '@/server/intelligence/measurement';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SITE_FILTERS: Array<{ label: string; value: '' | 'network' | SiteSlug }> = [
  { label: 'All',           value: '' },
  { label: 'Network-wide',  value: 'network' },
  { label: 'PokePrices',    value: 'pokemon' },
  { label: 'MTGPrices',     value: 'mtg' },
  { label: 'YGOPrices',     value: 'ygo' },
  { label: 'OnePiecePrices',value: 'onepiece' },
  { label: 'LorcanaPrices', value: 'lorcana' },
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
  searchParams?: Promise<{ site?: string; category?: string; status?: string; preset?: string; task_error?: string }>;
}

// Category breakdown presets. The operator sees 7 clickable chips at
// the top of the Inbox; each sets ?preset=<key> which maps to a
// (category, types[]) filter. Zero-count chips still render — the
// brief explicitly says "Zero categories should display zero, not
// disappear or be artificially populated."
const CATEGORY_PRESETS: Array<{ key: string; label: string; category: IntelligenceCategory | null; types?: string[] }> = [
  { key: 'striking_distance', label: 'Striking Distance',      category: 'seo',    types: ['striking_distance'] },
  { key: 'low_ctr',           label: 'Low CTR',                category: 'seo',    types: ['low_ctr'] },
  { key: 'zero_click',        label: 'Impressions, No Clicks', category: 'seo',    types: ['zero_click'] },
  { key: 'declining',         label: 'Declining Traffic',      category: 'seo',    types: ['declining', 'gaining'] },
  { key: 'indexing',          label: 'Indexing / Technical',   category: null,     types: [] /* multi-category — handled below */ },
  { key: 'content',           label: 'Content',                category: 'content' },
  { key: 'revenue',           label: 'Revenue / Monetisation', category: null,     types: [] /* multi-category — handled below */ },
];

function presetFilter(key: string): { category: IntelligenceCategory | null; categories?: IntelligenceCategory[]; types?: string[] } | null {
  switch (key) {
    case 'striking_distance': return { category: 'seo',     types: ['striking_distance'] };
    case 'low_ctr':           return { category: 'seo',     types: ['low_ctr'] };
    case 'zero_click':        return { category: 'seo',     types: ['zero_click'] };
    case 'declining':         return { category: 'seo',     types: ['declining', 'gaining'] };
    case 'indexing':          return { category: null,      categories: ['indexing', 'technical', 'data_health'] };
    case 'content':           return { category: 'content' };
    case 'revenue':           return { category: null,      categories: ['revenue', 'monetisation'] };
    default:                  return null;
  }
}

function matchesPreset(row: { category: string; type: string }, key: string): boolean {
  const p = presetFilter(key);
  if (!p) return false;
  if (p.types && p.types.length > 0 && !p.types.includes(row.type)) return false;
  if (p.category && row.category !== p.category) return false;
  if (p.categories && !p.categories.includes(row.category as IntelligenceCategory)) return false;
  return true;
}

export default async function AdminIntelligencePage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/intelligence');
  const sites = await listNetworkSites(sb);
  const params = (await searchParams) ?? {};
  const taskError = params.task_error;

  const siteParam     = params.site ?? '';
  const categoryParam = (params.category ?? '') as '' | IntelligenceCategory;
  const presetParam   = params.preset ?? '';
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

  // Resolve preset → (category, types). A preset overrides the
  // explicit category param so the chips are the primary UI.
  const preset = presetParam ? presetFilter(presetParam) : null;
  const effectiveCategory: IntelligenceCategory | null = preset?.category ?? (categoryParam || null);
  const effectiveTypes: string[] | undefined = preset?.types && preset.types.length > 0 ? preset.types : undefined;

  // When the preset spans multiple categories (indexing/technical/data_health
  // or revenue/monetisation), we filter in-memory after the query since
  // listIntelligenceInbox only supports a single category filter today.
  const presetCategories: IntelligenceCategory[] | undefined = preset?.categories;

  const [listResult, latestRunRow, breakdownResult] = await Promise.all([
    listIntelligenceInbox(sb, {
      site_slug,
      category: presetCategories ? null : effectiveCategory,
      types: effectiveTypes,
      statuses: statusesByView[statusParam] ?? statusesByView['active']!,
      limit: 200,
    }),
    sb.from('network_job_runs')
      .select('finished_at')
      .eq('job_name', 'intelligence.refresh')
      .order('started_at', { ascending: false })
      .limit(1).maybeSingle(),
    // Separate query for the Category Breakdown panel so the counts
    // reflect ALL ACTIVE items (not just the currently-filtered view).
    // Scoped to the active view AND the current site filter so the
    // chip counts honour the site filter the operator picked.
    sb.from('network_intelligence_items')
      .select('category, type')
      .in('status', ['open', 'task_created']),
  ]);
  const { rows, summary, error: queryError } = listResult;

  // Apply the multi-category preset filter in-memory (indexing /
  // technical / data_health, or revenue / monetisation). Done here
  // because listIntelligenceInbox only supports a single-category
  // filter.
  const filteredRows = presetCategories
    ? rows.filter((r) => presetCategories.includes(r.category))
    : rows;

  const lastRefreshIso = (latestRunRow.data as { finished_at: string | null } | null)?.finished_at ?? null;
  const refreshState = freshnessState(lastRefreshIso, { freshHours: 26, agingHours: 36 });

  // Category breakdown counts. All active items, not filtered.
  const breakdownRows = (breakdownResult.data ?? []) as Array<{ category: string; type: string }>;
  const breakdownCounts: Record<string, number> = {};
  for (const preset of CATEGORY_PRESETS) {
    breakdownCounts[preset.key] = breakdownRows.filter((r) => matchesPreset(r, preset.key)).length;
  }

  // CN-05 OS — fetch measurement state for every task-linked row in
  // one query so the Inbox can render the right chip (awaiting
  // verification / scheduled / in progress / complete). Service-role
  // reads only; no writes.
  const taskIds = Array.from(new Set(filteredRows.map((r) => r.task_id).filter((id): id is string => typeof id === 'string')));
  const measurementStateByTask = new Map<string, MeasurementState>();
  if (taskIds.length > 0) {
    const { data: taskMetaRows } = await sb
      .from('network_tasks')
      .select('id, metadata')
      .in('id', taskIds);
    for (const r of ((taskMetaRows ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>)) {
      measurementStateByTask.set(r.id, deriveMeasurementState(r.metadata));
    }
  }

  // Three deterministic sections.
  const needsAction = filteredRows.filter((r) => r.priority_score >= 70);
  const opportunities = filteredRows.filter((r) => r.priority_score >= 45 && r.priority_score < 70);
  const backlog = filteredRows.filter((r) => r.priority_score < 45);

  const headline = summary.total === 0
    ? statusParam === 'active' ? 'Nothing worth your attention right now.' : `No ${statusParam} items.`
    : `${summary.total} item${summary.total === 1 ? '' : 's'} in view.`;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/intelligence">
      <SectionHeader
        eyebrow="Collector Network OS · Intelligence"
        title="Intelligence Inbox"
        description={<>Deterministic ranked view of the highest-value signals across all five sites. Scores come from the engine, not an LLM. {headline}</>}
        actions={
          <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <FreshnessBadge state={refreshState} label={relativeLabel(lastRefreshIso)} />
            <form action={refreshIntelligenceAction}>
              <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">Refresh now</button>
            </form>
          </div>
        }
      />

      {taskError && (
        <Notice tone="danger">
          <strong>Create task failed:</strong> {taskError}
        </Notice>
      )}

      {/* ─── Category breakdown ───
          Shows the 7 category chips the brief specified. Clickable
          to filter. Zero-count chips still render (brief: "Zero
          categories should display zero, not disappear"). Counts
          are drawn from the full active-item set, not the current
          view, so switching filters doesn't zero out the chips. */}
      <Panel title="Active recommendations by category" eyebrow="Click a chip to filter · counts are live">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {CATEGORY_PRESETS.map((p) => {
            const count = breakdownCounts[p.key] ?? 0;
            const active = presetParam === p.key;
            return (
              <PresetChip
                key={p.key}
                label={p.label}
                count={count}
                active={active}
                href={buildHref(params, { site: siteParam, status: statusParam, preset: active ? '' : p.key })}
              />
            );
          })}
          <PresetChip
            label="All active"
            count={breakdownRows.length}
            active={!presetParam}
            href={buildHref(params, { site: siteParam, status: statusParam, preset: '' })}
          />
        </div>
      </Panel>

      {/* ─── Filters (simplified: just site + status) ───
          Category selection has moved to the clickable chip panel
          above. The brief: "Retain site and status filtering, but
          simplify the layout and remove redundant controls." */}
      <Panel title="Filters">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <FilterGroup label="Site">
            {SITE_FILTERS.map((f) => (
              <FilterLink key={f.value} href={buildHref(params, { site: f.value, status: statusParam, preset: presetParam })} active={siteParam === f.value}>
                {f.label}
              </FilterLink>
            ))}
          </FilterGroup>
          <FilterGroup label="Status">
            {(['active', 'snoozed', 'resolved', 'dismissed'] as const).map((v) => (
              <FilterLink key={v} href={buildHref(params, { site: siteParam, status: v, preset: presetParam })} active={statusParam === v}>
                {v}
              </FilterLink>
            ))}
          </FilterGroup>
        </div>
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--admin-text-muted)' }}>How priority is calculated</summary>
          <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--admin-text-muted)' }}>
            Formula: <code>{PRIORITY_FORMULA_LABEL}</code>. Each rule produces 0-100 impact/confidence/urgency/effort; priority is their weighted mean. Ease = 100 − effort.
          </div>
        </details>
      </Panel>

      {queryError && (
        <Notice tone="warning">
          <strong>Could not load intelligence items.</strong>{' '}
          Error: <code>{queryError}</code>. The admin shell has been kept online. Refresh in a few seconds (PostgREST
          schema caches reload after column/enum renames) or inspect the Supabase logs.
        </Notice>
      )}

      {!queryError && rows.length === 0 && (
        <EmptyPanelNotice>
          {statusParam === 'active'
            ? <>No intelligence items yet. Click <strong>Refresh now</strong> at the top to generate the first batch, or wait for the scheduled run.</>
            : <>No items for the current filters. Try widening the site/category filters.</>}
        </EmptyPanelNotice>
      )}

      {/* ─── Sections ─── */}
      {needsAction.length > 0 && (
        <IntelSection title="Needs action now" eyebrow={`${needsAction.length} · priority ≥ 70`} rows={needsAction} measurementStateByTask={measurementStateByTask} />
      )}
      {opportunities.length > 0 && (
        <IntelSection title="Opportunities" eyebrow={`${opportunities.length} · priority 45-69`} rows={opportunities} measurementStateByTask={measurementStateByTask} />
      )}
      {backlog.length > 0 && (
        <IntelSection title="Backlog" eyebrow={`${backlog.length} · priority < 45`} rows={backlog} collapsibleAfter={10} measurementStateByTask={measurementStateByTask} />
      )}
    </AdminShell>
  );
}

function IntelSection({ title, eyebrow, rows, collapsibleAfter, measurementStateByTask }: { title: string; eyebrow: string; rows: IntelligenceRowRead[]; collapsibleAfter?: number; measurementStateByTask: Map<string, MeasurementState> }) {
  const visible = collapsibleAfter ? rows.slice(0, collapsibleAfter) : rows;
  const hidden = collapsibleAfter ? rows.slice(collapsibleAfter) : [];
  return (
    <Panel title={title} eyebrow={eyebrow}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {visible.map((row) => <IntelCard key={row.id} row={row} measurementState={row.task_id ? measurementStateByTask.get(row.task_id) ?? null : null} />)}
      </ul>
      {hidden.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Show {hidden.length} more</summary>
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
            {hidden.map((row) => <IntelCard key={row.id} row={row} measurementState={row.task_id ? measurementStateByTask.get(row.task_id) ?? null : null} />)}
          </ul>
        </details>
      )}
    </Panel>
  );
}

function IntelCard({ row, measurementState }: { row: IntelligenceRowRead; measurementState: MeasurementState | null }) {
  const band = priorityBand(row.priority_score ?? 0);
  const signalBadge = row.signal_kind === 'opportunity' ? 'info'
                   : row.signal_kind === 'positive'    ? 'success'
                   : row.signal_kind === 'risk'        ? 'failed'
                   : row.signal_kind === 'warning'     ? 'warning'
                   :                                      'disabled';
  const slug = row.network_sites?.slug ?? 'network';
  const siteDisplay = siteDisplayName(slug, 'Network');
  const upside: { label?: string; rationale?: string } | null =
    row.expected_upside && typeof row.expected_upside === 'object' && !Array.isArray(row.expected_upside)
      ? (row.expected_upside as { label?: string; rationale?: string })
      : null;
  const upsideLabel = typeof upside?.label === 'string' ? upside.label : null;

  // Contextual action target.
  //
  // Intelligence Simplification — the generic "Inspect opportunity"
  // link to /admin/seo/opportunities has been REMOVED. It sent the
  // operator out of the Intelligence workflow into a parallel SEO
  // opportunity surface that duplicated the same data and didn't
  // carry the task/baseline/prompt/receipt controls. The primary
  // Intelligence actions (Review & act, Continue action, Open task)
  // keep the operator on the Intelligence → task-detail workflow;
  // the specialist SEO opportunities list is still reachable from
  // the admin sidebar for diagnostics but is no longer the next
  // click from an Intelligence card.
  const actionLink =
    row.category === 'indexing' ? { href: '/admin/seo/sitemaps', label: 'Open sitemaps' }
    : (row.type === 'failed_job' || row.type === 'stale_job' || row.type === 'stale_job_network') ? { href: '/admin/jobs', label: 'Open jobs' }
    : null;

  return (
    <li style={{
      padding: '12px 0',
      borderBottom: '1px solid var(--admin-border)',
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      gap: 10,
      alignItems: 'start',
    }}>
      <PriorityPill band={band} value={row.priority_score} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <StatusBadge state={signalBadge} label={siteDisplay} />
          <StatusBadge state="info" label={intelTypeLabel(row.type)} />
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{row.title}</span>
          {row.status === 'task_created' && <StatusBadge state="success" label="task created" />}
          {measurementState === 'awaiting_verification' && <StatusBadge state="info" label="awaiting verification" />}
          {measurementState === 'scheduled' && <StatusBadge state="info" label="scheduled for measurement" />}
          {measurementState === 'in_progress' && <StatusBadge state="info" label="being measured" />}
          {measurementState === 'complete' && <StatusBadge state="success" label="measurement complete" />}
          {row.status === 'snoozed' && row.snoozed_until && (
            <StatusBadge state="warning" label={`snoozed to ${safeDate(row.snoozed_until)}`} />
          )}
        </div>
        <p style={{ fontSize: 12.5, margin: '4px 0 4px', color: 'var(--admin-text-muted)', lineHeight: 1.45 }}>
          {row.summary || '(no summary)'}
        </p>
        {row.recommended_action && (
          <p style={{ fontSize: 12, margin: '0 0 4px' }}>
            <strong>Action:</strong> {row.recommended_action}
          </p>
        )}
        {upsideLabel && (
          <p style={{ fontSize: 12, margin: 0, color: 'var(--admin-text-muted)' }}>
            <strong>Potential:</strong> {upsideLabel}
          </p>
        )}

        {row.status === 'open' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <CreateTaskButton itemId={row.id} />
            <details style={{ display: 'inline-block' }}>
              <summary className="ui-btn ui-btn--secondary ui-btn--sm" style={{ cursor: 'pointer', fontSize: 11 }}>More…</summary>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <SnoozeMenuInline id={row.id} />
                <form action={dismissItemAction}>
                  <input type="hidden" name="item_id" value={row.id} />
                  <button type="submit" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ fontSize: 11 }}>Dismiss</button>
                </form>
                <form action={resolveItemAction}>
                  <input type="hidden" name="item_id" value={row.id} />
                  <button type="submit" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ fontSize: 11 }}>Mark resolved</button>
                </form>
              </div>
            </details>
          </div>
        )}
        {row.status === 'task_created' && row.task_id && (
          <div style={{ fontSize: 12, marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* CN-05 OS Phase B — route to the task detail page where
                the Claude Code prompt generator + implementation
                receipt controls live, not the search-param flash on
                the list. */}
            <Link href={`/admin/tasks/${row.task_id}?from=intelligence`} className="ui-btn ui-btn--primary ui-btn--sm" style={{ fontSize: 11 }}>
              Continue action
            </Link>
            <form action={resolveItemAction} style={{ display: 'inline' }}>
              <input type="hidden" name="item_id" value={row.id} />
              <button type="submit" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ fontSize: 11 }}>Mark resolved</button>
            </form>
          </div>
        )}

        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--admin-text-muted)' }}>Score details, evidence &amp; source</summary>
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 6, marginBottom: 10 }}>
              <ScoreKV label="Impact"     value={row.impact_score ?? 0} />
              <ScoreKV label="Confidence" value={row.confidence_score ?? 0} />
              <ScoreKV label="Urgency"    value={row.urgency_score ?? 0} />
              <ScoreKV label="Effort"     value={row.effort_score ?? 0} />
            </div>
            <h4 className="admin-eyebrow" style={{ marginBottom: 4 }}>Evidence</h4>
            <pre style={{ background: 'var(--admin-surface-strong)', padding: 10, borderRadius: 6, fontSize: 11, maxHeight: 260, overflow: 'auto' }}>
              {safeStringify(row.evidence)}
            </pre>
            <h4 className="admin-eyebrow" style={{ marginTop: 10, marginBottom: 4 }}>Source</h4>
            <div style={{ fontSize: 11.5, color: 'var(--admin-text-muted)' }}>
              <div><code>{row.source_type}</code> · <code>{row.source_key}</code></div>
              <div>first detected <code>{row.first_detected_at}</code> · last detected <code>{row.last_detected_at}</code></div>
            </div>
          </div>
        </details>
      </div>
      {actionLink && (
        <Link href={actionLink.href} className="ui-btn ui-btn--secondary ui-btn--sm" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          {actionLink.label}
        </Link>
      )}
    </li>
  );
}

function SnoozeMenuInline({ id }: { id: string }) {
  return (
    <>
      {[1, 7, 30].map((days) => (
        <form key={days} action={snoozeItemAction} style={{ display: 'inline' }}>
          <input type="hidden" name="item_id" value={id} />
          <input type="hidden" name="days" value={days} />
          <button type="submit" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ fontSize: 11 }}>Snooze {days}d</button>
        </form>
      ))}
    </>
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
      display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
      padding: '4px 8px', borderRadius: 8,
      border: `1px solid ${color}`, color,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
      minWidth: 46,
    }}>
      <span style={{ fontSize: 15, lineHeight: 1 }}>{value}</span>
      <span style={{ textTransform: 'uppercase', fontSize: 9, marginTop: 1 }}>{band}</span>
    </div>
  );
}

function ScoreKV({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: '1px solid var(--admin-border)', borderRadius: 6, padding: '4px 8px', background: 'var(--admin-surface)' }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-subtle)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{value}</div>
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

function buildHref(current: Record<string, string | undefined>, next: { site: string; status: string; preset?: string; category?: string }): string {
  const sp = new URLSearchParams();
  if (next.site) sp.set('site', next.site);
  if (next.preset) sp.set('preset', next.preset);
  if (next.category) sp.set('category', next.category);
  if (next.status && next.status !== 'active') sp.set('status', next.status);
  void current;
  const qs = sp.toString();
  return qs ? `/admin/intelligence?${qs}` : `/admin/intelligence`;
}

function PresetChip({ label, count, active, href }: { label: string; count: number; active: boolean; href: string }) {
  const bg = active ? 'var(--admin-accent, #4a90e2)' : (count > 0 ? 'transparent' : 'transparent');
  const color = active ? '#fff' : (count > 0 ? 'var(--admin-text)' : 'var(--admin-text-muted)');
  const border = active ? 'var(--admin-accent, #4a90e2)' : (count > 0 ? 'var(--admin-border)' : 'var(--admin-border)');
  return (
    <Link
      href={href}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderRadius: 999, fontSize: 12.5,
        border: `1px solid ${border}`, background: bg, color,
        textDecoration: 'none', fontWeight: active ? 600 : 500,
        opacity: count === 0 && !active ? 0.6 : 1,
      }}
    >
      <span>{label}</span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 22, height: 20, padding: '0 6px', borderRadius: 10,
        background: active ? 'rgba(255,255,255,0.25)' : 'var(--admin-surface-strong)',
        color: active ? '#fff' : 'var(--admin-text)',
        fontSize: 11, fontWeight: 700,
      }}>{count}</span>
    </Link>
  );
}
