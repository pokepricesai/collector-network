import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { runDryRun, type MonthRow, type CurrencyRow, type WindowResult } from '@/server/impact/dry-run';
import { runDeleteScopeAudit } from '@/server/impact/delete-scope';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Full 365-day pull may take ~2-5 min depending on EPN volume.
// Fluid Compute default is 300s on all plans.
export const maxDuration = 300;

// READ-ONLY. This page gates the EPN ledger reset:
//   1. Full 365-day Impact dry run.
//   2. Delete-scope audit of exactly what would be removed.
//   3. Backup plan preview (SQL only, not executed).
//
// Nothing on this page writes to the ledger. The destructive migration
// is a separate, explicit step gated on this report coming back clean.

export default async function ImpactResetPage() {
  const { admin, sb } = await requireAdmin('/admin/revenue/impact-reset');
  const sites = await listNetworkSites(sb);
  const [dry, scope] = await Promise.all([runDryRun(), runDeleteScopeAudit(sb)]);

  const dryTone =
    dry.verdict === 'ready' ? 'success' :
    dry.verdict === 'partial' ? 'warning' :
    'danger';

  const backupSql = buildBackupSql(scope.epn_source_ids, scope.epn_sources.map((s) => s.slug));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue/impact-reset">
      <SectionHeader
        eyebrow="Revenue · Reset gate"
        title="Impact EPN rebuild — dry run + backup plan"
        description={
          <>
            Read-only. Runs the full 365-day Impact backfill in-memory,
            audits exactly which existing rows would be removed by a
            scoped EPN reset, and renders the backup SQL. Nothing on
            this page writes to the ledger. Ran at <code>{dry.ran_at}</code>.
          </>
        }
      />

      {/* ───── Section 1 · Dry-run verdict ─────────────────────── */}
      <Panel title="365-day API dry run — verdict" eyebrow="Gate for the destructive step">
        <Notice tone={dryTone}>
          <strong style={{ textTransform: 'uppercase' }}>{dry.verdict}</strong>
          {dry.skipped_reason ? <> — {dry.skipped_reason}</> : null}
        </Notice>
        {dry.blocking_reasons.length > 0 && (
          <ul style={{ fontSize: 13, lineHeight: 1.7, margin: '10px 0 0', paddingLeft: 20 }}>
            {dry.blocking_reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
        {dry.warnings.length > 0 && (
          <ul style={{ fontSize: 12.5, lineHeight: 1.6, margin: '10px 0 0', paddingLeft: 20, color: 'var(--admin-text-muted)' }}>
            {dry.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 12 }}>
          <KV label="Window size" value={`${dry.window_days}d`} />
          <KV label="Windows planned" value={String(dry.window_count)} />
          <KV label="Windows failed" value={String(dry.windows.filter((w) => w.status === 'failed').length)} warn={dry.windows.some((w) => w.status === 'failed')} />
          <KV label="Windows partial" value={String(dry.windows.filter((w) => w.status === 'partial').length)} warn={dry.windows.some((w) => w.status === 'partial')} />
          <KV label="API calls" value={dry.total_api_calls.toLocaleString()} />
          <KV label="Actions fetched (raw)" value={dry.actions_fetched_raw.toLocaleString()} />
          <KV label="ActionUpdates fetched" value={dry.action_updates_fetched_raw.toLocaleString()} />
          <KV label="Distinct Action IDs" value={dry.distinct_action_ids.toLocaleString()} />
          <KV label="Duplicate Action IDs" value={dry.duplicate_action_ids.toLocaleString()} warn={dry.duplicate_action_ids > 0} />
          <KV label="Date coverage" value={dry.oldest_event_date && dry.newest_event_date ? `${dry.oldest_event_date} → ${dry.newest_event_date}` : '—'} />
          <KV
            label="Per-window safety cap"
            value={dry.windows.some((w) => w.per_window_safety_cap_hit)
              ? `HIT · ${dry.per_window_safety_cap.toLocaleString()}`
              : `${dry.per_window_safety_cap.toLocaleString()} (clean)`}
            warn={dry.windows.some((w) => w.per_window_safety_cap_hit)}
          />
          <KV
            label="Overall safety cap"
            value={dry.overall_safety_cap_hit
              ? `HIT · ${dry.overall_safety_cap.toLocaleString()}`
              : `${dry.overall_safety_cap.toLocaleString()} (clean)`}
            warn={dry.overall_safety_cap_hit}
          />
        </div>
      </Panel>

      {/* ───── Section 2 · Per-window table ────────────────────── */}
      <Panel title="Per-window results" eyebrow="Newest first; each ≤ 45 days">
        <Table
          columns={[
            { key: 'i',    header: '#',           className: 'col-num', render: (r: WindowRow) => String(r.index + 1) },
            { key: 'range',header: 'Range',       render: (r: WindowRow) => <code>{r.start_date} → {r.end_date}</code> },
            { key: 'st',   header: 'Status',      render: (r: WindowRow) =>
              r.status === 'ok'
                ? <StatusBadge state="success" label="ok" />
                : r.status === 'partial'
                ? <StatusBadge state="warning" label="partial" />
                : <StatusBadge state="failed" label="failed" />,
            },
            { key: 'ap',   header: '/Actions pages',          className: 'col-num', render: (r: WindowRow) => String(r.actions_pages) },
            { key: 'af',   header: '/Actions fetched',        className: 'col-num', render: (r: WindowRow) => r.actions_fetched.toLocaleString() },
            { key: 'at',   header: '/Actions total (envelope)', className: 'col-num', render: (r: WindowRow) => r.actions_total_reported != null ? r.actions_total_reported.toLocaleString() : '—' },
            { key: 'up',   header: '/ActionUpdates pages',    className: 'col-num', render: (r: WindowRow) => String(r.action_updates_pages) },
            { key: 'uf',   header: '/ActionUpdates fetched',  className: 'col-num', render: (r: WindowRow) => r.action_updates_fetched.toLocaleString() },
            { key: 'cap',  header: 'Cap hit?',    render: (r: WindowRow) => r.per_window_safety_cap_hit ? <StatusBadge state="warning" label="yes" /> : <span className="col-dim">no</span> },
            { key: 'd',    header: 'Duration',    className: 'col-num', render: (r: WindowRow) => `${(r.duration_ms / 1000).toFixed(1)}s` },
            { key: 'err',  header: 'Error',       render: (r: WindowRow) => r.error ? <code style={{ fontSize: 11 }}>{r.error}</code> : <span className="col-dim">—</span> },
          ]}
          rows={dry.windows.map((w) => ({ ...w, id: String(w.index) })) as (WindowRow & { id: string })[]}
          empty="No windows."
        />
      </Panel>

      {/* ───── Section 3 · State breakdown ─────────────────────── */}
      <Panel title="State inventory" eyebrow="Across all fetched Actions">
        {dry.unknown_states.length > 0 && (
          <Notice tone="warning">
            Unknown state values observed: {dry.unknown_states.map((s) => <code key={s} style={{ marginRight: 6 }}>{s}</code>)}
            — resolve semantics before rebuild.
          </Notice>
        )}
        <ul style={{ fontSize: 13, lineHeight: 1.7, margin: '10px 0 0', paddingLeft: 20 }}>
          {Object.entries(dry.by_state).sort((a, b) => b[1] - a[1]).map(([state, n]) => (
            <li key={state}>
              <code>{state}</code> — {n.toLocaleString()}
              {dry.known_states.includes(state) ? null : <> <StatusBadge state="warning" label="unknown" /></>}
            </li>
          ))}
          {Object.keys(dry.by_state).length === 0 && <li className="col-dim">(no State values observed)</li>}
        </ul>
      </Panel>

      {/* ───── Section 4 · Currency totals ─────────────────────── */}
      <Panel title="Totals by currency" eyebrow="Payout + sale amount, in minor units">
        <Table
          columns={[
            { key: 'c',  header: 'Currency', render: (r: CurrencyRowDisplay) => <code>{r.currency}</code> },
            { key: 'n',  header: 'Actions',  className: 'col-num', render: (r: CurrencyRowDisplay) => r.count.toLocaleString() },
            { key: 'p',  header: 'Payout (major)',  className: 'col-num', render: (r: CurrencyRowDisplay) => formatMajor(r.payout_minor, r.currency) },
            { key: 'a',  header: 'Gross sale (major)',  className: 'col-num', render: (r: CurrencyRowDisplay) => formatMajor(r.amount_minor, r.currency) },
          ]}
          rows={dry.by_currency.map((c, i) => ({ ...c, id: `${i}` }))}
          empty="No currency data."
        />
      </Panel>

      {/* ───── Section 5 · Monthly totals ──────────────────────── */}
      <Panel title="Monthly totals" eyebrow="Count by state + payout/amount per currency">
        <Table
          columns={[
            { key: 'm',  header: 'Month',   render: (r: MonthRowDisplay) => <code>{r.month}</code> },
            { key: 'n',  header: 'Total',   className: 'col-num', render: (r: MonthRowDisplay) => r.count.toLocaleString() },
            { key: 'pe', header: 'Pending', className: 'col-num', render: (r: MonthRowDisplay) => r.pending.toLocaleString() },
            { key: 'ap', header: 'Approved',className: 'col-num', render: (r: MonthRowDisplay) => r.approved.toLocaleString() },
            { key: 'lo', header: 'Locked',  className: 'col-num', render: (r: MonthRowDisplay) => r.locked.toLocaleString() },
            { key: 'pa', header: 'Paid',    className: 'col-num', render: (r: MonthRowDisplay) => r.paid.toLocaleString() },
            { key: 're', header: 'Reversed',className: 'col-num', render: (r: MonthRowDisplay) => r.reversed.toLocaleString(), },
            { key: 'ot', header: 'Other',   className: 'col-num', render: (r: MonthRowDisplay) => r.other > 0 ? <strong style={{ color: 'var(--warning)' }}>{r.other.toLocaleString()}</strong> : <span className="col-dim">0</span> },
            { key: 'py', header: 'Payout',  render: (r: MonthRowDisplay) => <CurrencyBreakdown map={r.payout_minor_by_currency} /> },
            { key: 'am', header: 'Gross sale', render: (r: MonthRowDisplay) => <CurrencyBreakdown map={r.amount_minor_by_currency} /> },
          ]}
          rows={dry.by_month.map((m) => ({ ...m, id: m.month }))}
          empty="No monthly data."
        />
      </Panel>

      {/* ───── Section 6 · Field integrity ─────────────────────── */}
      <Panel title="Field integrity" eyebrow="Missing critical fields on fetched Actions">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <KV label="Missing Id" value={dry.missing_action_id.toLocaleString()} warn={dry.missing_action_id > 0} />
          <KV label="Missing State" value={dry.missing_state.toLocaleString()} warn={dry.missing_state > 0} />
          <KV label="Missing EventDate" value={dry.missing_event_date.toLocaleString()} warn={dry.missing_event_date > 0} />
          <KV label="Missing Payout" value={dry.missing_payout.toLocaleString()} warn={dry.missing_payout > 0} />
          <KV label="Missing Currency" value={dry.missing_currency.toLocaleString()} warn={dry.missing_currency > 0} />
        </div>
      </Panel>

      {/* ───── Section 7 · Attribution ─────────────────────────── */}
      <Panel title="Attribution — SubId1 coverage" eyebrow="Site attribution requires outbound links to tag SubId1">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 10 }}>
          <KV label="With SubId1" value={dry.with_sub_id_1.toLocaleString()} />
          <KV label="Without SubId1" value={dry.without_sub_id_1.toLocaleString()} warn={dry.with_sub_id_1 === 0 && dry.without_sub_id_1 > 0} />
          <KV
            label="SubId1 coverage"
            value={dry.actions_fetched_raw > 0 ? `${((dry.with_sub_id_1 / dry.actions_fetched_raw) * 100).toFixed(0)}%` : '—'}
          />
        </div>
        <div style={{ fontSize: 12.5 }}>
          <strong>Distinct SubId1 values seen</strong> (first 20):{' '}
          {dry.distinct_sub_id_1_values.length === 0
            ? <span className="col-dim">none</span>
            : dry.distinct_sub_id_1_values.map((v) => <code key={v} style={{ marginRight: 6 }}>{v}</code>)}
        </div>
      </Panel>

      {/* ───── Section 8 · Delete-scope audit ──────────────────── */}
      <Panel title="Delete-scope audit" eyebrow="Exactly which existing rows would be removed by a scoped EPN reset">
        {scope.epn_sources.length === 0 ? (
          <Notice tone="warning">
            No <code>network_revenue_sources</code> rows with <code>kind = ebay_epn</code>. There is nothing EPN-scoped to delete.
          </Notice>
        ) : (
          <Table
            columns={[
              { key: 'sl', header: 'Source slug', render: (r: EpnSrcRow) => <code>{r.slug}</code> },
              { key: 'dn', header: 'Display name', render: (r: EpnSrcRow) => r.display_name },
              { key: 'cc', header: 'Currency', render: (r: EpnSrcRow) => <code>{r.default_currency}</code> },
              { key: 'ac', header: 'Active',   render: (r: EpnSrcRow) => r.is_active ? 'yes' : 'no' },
              { key: 'nr', header: 'Revenue events', className: 'col-num', render: (r: EpnSrcRow) => (scope.counts.network_revenue_events_by_source[r.slug] ?? 0).toLocaleString() },
            ]}
            rows={scope.epn_sources.map((s) => ({ ...s, id: s.id }))}
            empty="No EPN sources."
          />
        )}

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Rows that would be removed</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <KV label="network_revenue_events" value={scope.counts.network_revenue_events.toLocaleString()} />
          <KV label="network_affiliate_conversions" value={scope.counts.network_affiliate_conversions.toLocaleString()} />
          <KV label="network_affiliate_status_history" value={scope.counts.network_affiliate_status_history.toLocaleString()} />
          <KV label="network_revenue_daily (rollups)" value={scope.counts.network_revenue_daily.toLocaleString()} />
        </div>

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Related rows — NOT deleted</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <KV label="network_affiliate_clicks (EPN)" value={scope.counts.network_affiliate_clicks.toLocaleString()} />
          <KV label="partner opportunities touching EPN" value={scope.counts.network_partner_opportunities_touching_epn.toLocaleString()} />
        </div>

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>FK cascade behaviour (verified against the schema)</h3>
        <Table
          columns={[
            { key: 't', header: 'Table',  render: (r: CascadeNoteRow) => <code>{r.table}</code> },
            { key: 'f', header: 'FK',     render: (r: CascadeNoteRow) => <code style={{ fontSize: 11 }}>{r.fk}</code> },
            { key: 'a', header: 'Delete semantics', render: (r: CascadeNoteRow) => r.delete_action },
          ]}
          rows={scope.cascade_notes.map((c, i) => ({ ...c, id: String(i) }))}
          empty=""
        />

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Non-EPN sanity — totals that MUST NOT change post-reset</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <KV label="Non-EPN revenue events" value={scope.non_epn_sanity.non_epn_revenue_events.toLocaleString()} />
          <KV label="Sponsorship-attributed events" value={scope.non_epn_sanity.sponsorship_attributed_revenue_events.toLocaleString()} />
          <KV label="Revenue sources (total)" value={scope.non_epn_sanity.revenue_sources_total.toLocaleString()} />
          <KV label="Revenue sources (non-EPN)" value={scope.non_epn_sanity.revenue_sources_non_epn.toLocaleString()} />
          <KV label="Operating costs" value={scope.non_epn_sanity.operating_costs.toLocaleString()} />
          <KV label="Tasks" value={scope.non_epn_sanity.tasks.toLocaleString()} />
          <KV label="Partners" value={scope.non_epn_sanity.partners.toLocaleString()} />
          <KV label="Approvals" value={scope.non_epn_sanity.approvals.toLocaleString()} />
        </div>

        {scope.warnings.length > 0 && (
          <ul style={{ fontSize: 12.5, lineHeight: 1.6, margin: '12px 0 0', paddingLeft: 20, color: 'var(--admin-text-muted)' }}>
            {scope.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </Panel>

      {/* ───── Section 9 · Backup SQL ──────────────────────────── */}
      <Panel title="Backup plan — SQL preview (not executed)" eyebrow="Would run before the destructive step">
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: '0 0 10px' }}>
          The following SQL creates archival tables holding a verbatim copy of every EPN-scoped row across the four affected tables.
          No normal query path reads from these tables; they exist as insurance.
          <strong> This block is <em>not</em> executed by this page.</strong>
        </p>
        <pre style={{
          background: 'var(--admin-surface-strong)',
          padding: 12,
          borderRadius: 6,
          maxHeight: 420,
          overflow: 'auto',
          fontSize: 12,
          fontFamily: 'var(--admin-font-mono)',
          whiteSpace: 'pre',
        }}>
          {backupSql}
        </pre>
        <ul style={{ fontSize: 12.5, lineHeight: 1.65, margin: '10px 0 0', paddingLeft: 20, color: 'var(--admin-text-muted)' }}>
          <li>Applied as a Supabase migration (<code>supabase/migrations/</code>) in the follow-up step — not auto-run.</li>
          <li>Table names are timestamp-suffixed so re-running after a schema change does not clobber a prior backup.</li>
          <li>Backup tables carry no RLS by design (admin-only via <code>network_is_admin()</code> would require more SQL; these are inert archival).</li>
          <li>Restoration path: <code>INSERT INTO network_revenue_events SELECT * FROM legacy_epn_events_backup_&lt;ts&gt;;</code> — only if the API rebuild turns out wrong.</li>
        </ul>
      </Panel>
    </AdminShell>
  );
}

// ─── Visual helpers ────────────────────────────────────────────

type WindowRow = WindowResult;
type MonthRowDisplay = MonthRow;
type CurrencyRowDisplay = CurrencyRow;
type EpnSrcRow = { id: string; slug: string; display_name: string; default_currency: string; is_active: boolean };
type CascadeNoteRow = { table: string; fk: string; delete_action: string };

function KV({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{
      border: '1px solid var(--admin-border)',
      borderRadius: 'var(--radius-md)',
      padding: '8px 10px',
      background: warn ? 'var(--warning-soft)' : 'var(--admin-surface)',
    }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-subtle)', fontWeight: 700, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: warn ? 'var(--warning)' : 'var(--admin-text)' }}>
        {value}
      </div>
    </div>
  );
}

function CurrencyBreakdown({ map }: { map: Record<string, number> }) {
  const entries = Object.entries(map);
  if (entries.length === 0) return <span className="col-dim">—</span>;
  return (
    <span style={{ fontSize: 12.5 }}>
      {entries.map(([cur, minor], i) => (
        <span key={cur} style={{ marginRight: i < entries.length - 1 ? 8 : 0 }}>
          <code>{cur}</code> {formatMajor(minor, cur)}
        </span>
      ))}
    </span>
  );
}

function formatMajor(minor: number, currency: string): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

function buildBackupSql(epnSourceIds: string[], epnSlugs: string[]): string {
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  if (epnSourceIds.length === 0) {
    return `-- No EPN sources detected. Nothing to back up.
-- Confirm by running:
select slug, display_name, kind, is_active
  from public.network_revenue_sources
 where kind = 'ebay_epn';
`;
  }
  const idList = epnSourceIds.map((id) => `'${id}'`).join(', ');
  const slugList = epnSlugs.map((s) => `'${s}'`).join(', ');
  return `-- ───────────────────────────────────────────────────────────────
-- EPN LEGACY BACKUP · ${new Date().toISOString().slice(0, 19)}Z
-- Scope: network_revenue_sources where kind = 'ebay_epn'
-- Sources: ${slugList}
-- ───────────────────────────────────────────────────────────────

begin;

-- 1. Revenue events for EPN sources (the primary ledger slice).
create table if not exists public.legacy_epn_events_backup_${ts} as
select e.*, s.slug as _source_slug
  from public.network_revenue_events e
  join public.network_revenue_sources s on s.id = e.source_id
 where e.source_id in (${idList});
comment on table public.legacy_epn_events_backup_${ts}
  is 'EPN revenue_events snapshot before API rebuild. Archival only — never read by normal queries.';

-- 2. Status history for every revenue event we are backing up.
create table if not exists public.legacy_epn_status_history_backup_${ts} as
select h.*
  from public.network_affiliate_status_history h
 where h.revenue_event_id in (
   select id from public.network_revenue_events
    where source_id in (${idList})
 );

-- 3. Affiliate conversions for EPN sources.
create table if not exists public.legacy_epn_conversions_backup_${ts} as
select c.*
  from public.network_affiliate_conversions c
 where c.source_id in (${idList});

-- 4. Daily rollups for EPN sources (cheap to rebuild; stored for parity).
create table if not exists public.legacy_epn_daily_backup_${ts} as
select d.*
  from public.network_revenue_daily d
 where d.source_id in (${idList});

-- 5. Click rows kept in place (FK is SET NULL, not CASCADE); snapshot for
--    parity so a full point-in-time restore is possible if needed.
create table if not exists public.legacy_epn_clicks_backup_${ts} as
select cl.*
  from public.network_affiliate_clicks cl
 where cl.source_id in (${idList});

-- Verify counts match what the admin page reported before proceeding.
select 'events'       as t, count(*) from public.legacy_epn_events_backup_${ts}
union all
select 'status_hist', count(*) from public.legacy_epn_status_history_backup_${ts}
union all
select 'conversions', count(*) from public.legacy_epn_conversions_backup_${ts}
union all
select 'daily',       count(*) from public.legacy_epn_daily_backup_${ts}
union all
select 'clicks',      count(*) from public.legacy_epn_clicks_backup_${ts};

commit;
`;
}
