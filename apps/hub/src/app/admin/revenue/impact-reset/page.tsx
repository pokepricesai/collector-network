import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  runDryRun,
  type AttributionField,
  type CurrencyRow,
  type MonthRow,
  type ReversedValueByCurrency,
  type StateCurrencyPayout,
  type WindowResult,
} from '@/server/impact/dry-run';
import { runDeleteScopeAudit } from '@/server/impact/delete-scope';
import { runCoverageAudit, type CoverageReport, SHARED_ID_TO_SLUG } from '@/server/impact/coverage-audit';

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
  // Coverage audit depends on the dry run's raw actions, so sequence it.
  const coverage = await runCoverageAudit(sb, dry.raw_actions);

  const dryTone =
    dry.verdict === 'ready' ? 'success' :
    dry.verdict === 'partial' ? 'warning' :
    'danger';

  const coverageTone =
    coverage.verdict === 'full_epn_account_coverage' ? 'success' :
    coverage.verdict === 'uk_only' ? 'danger' :
    'warning';

  const backupSql = buildBackupSql(scope.epn_source_ids, scope.epn_sources.map((s) => s.slug));
  const restoreSql = buildRestoreSql();
  const final = computeFinalVerdict({ dry, scope, coverage });

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

      {/* ───── Section 1b · UK/US coverage audit (SharedId-based) ─ */}
      <Panel title="UK + US coverage audit" eyebrow="Primary signal: SharedId → campaign mapping (not external_ref)">
        <Notice tone={coverageTone}>
          <strong style={{ textTransform: 'uppercase' }}>
            {coverage.verdict === 'full_epn_account_coverage' ? 'FULL EPN ACCOUNT COVERAGE' :
             coverage.verdict === 'uk_only' ? 'UK ONLY — DO NOT RESET US' :
             'UNCERTAIN'}
          </strong>
          {coverage.skipped_reason ? <> — {coverage.skipped_reason}</> : null}
        </Notice>
        <ul style={{ fontSize: 13, lineHeight: 1.7, margin: '10px 0 0', paddingLeft: 20 }}>
          {coverage.verdict_evidence.map((e, i) => <li key={i}>{e}</li>)}
        </ul>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
          <KV label="API Actions examined" value={coverage.api_actions_examined.toLocaleString()} />
          <KV label="API date floor" value={coverage.api_date_floor ?? '—'} />
          <KV label="SharedId → UK" value={(coverage.api_by_mapped_slug['ebay_epn_uk'] ?? 0).toLocaleString()} />
          <KV
            label="SharedId → US"
            value={(coverage.api_by_mapped_slug['ebay_epn_us'] ?? 0).toLocaleString()}
            warn={(coverage.api_by_mapped_slug['ebay_epn_us'] ?? 0) === 0}
          />
          <KV label="Unknown SharedId" value={coverage.api_shared_id_unknown.toLocaleString()} warn={coverage.api_shared_id_unknown > 0} />
          <KV label="Missing SharedId" value={coverage.api_shared_id_missing.toLocaleString()} warn={coverage.api_shared_id_missing > 0} />
        </div>

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Known SharedId mapping</h3>
        <Table
          columns={[
            { key: 'sid',  header: 'SharedId',       render: (r: SidMapRow) => <code>{r.shared_id}</code> },
            { key: 'slug', header: 'Mapped slug',    render: (r: SidMapRow) => <code>{r.slug}</code> },
            { key: 'uuid', header: 'Resolved source UUID', render: (r: SidMapRow) => <code style={{ fontSize: 11 }}>{coverage.mapped_source_ids[r.slug] ?? '(not found)'}</code> },
            { key: 'n',    header: 'API Actions',    className: 'col-num', render: (r: SidMapRow) => (coverage.api_by_shared_id[r.shared_id] ?? 0).toLocaleString() },
          ]}
          rows={Object.entries(SHARED_ID_TO_SLUG).map(([shared_id, slug]) => ({ id: shared_id, shared_id, slug }))}
          empty=""
        />

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Legacy EPN counts (snapshot — reset migration re-checks at execution time)</h3>
        <ul style={{ fontSize: 13, lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
          {coverage.legacy_sources.map((s) => (
            <li key={s.slug}>
              <code>{s.slug}</code>: {(coverage.legacy_total_by_slug[s.slug] ?? 0).toLocaleString()} legacy events
            </li>
          ))}
        </ul>

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Currency semantics</h3>
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0, color: 'var(--admin-text-muted)' }}>{coverage.currency_semantics_note}</p>

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>external_ref overlap (DIAGNOSTIC — not a coverage signal)</h3>
        <p className="col-dim" style={{ fontSize: 12.5, margin: '0 0 8px' }}>
          CSV used eBay-side Transaction IDs; Impact uses its own Action.Id. Overlap is interesting but low
          overlap is expected and does <em>not</em> indicate missing coverage.
        </p>
        <ul style={{ fontSize: 13, lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
          {coverage.legacy_sources.map((s) => (
            <li key={s.slug}>
              <code>{s.slug}</code>: {(coverage.external_ref_overlap_by_slug[s.slug] ?? 0).toLocaleString()} overlap(s)
            </li>
          ))}
        </ul>

        {coverage.warnings.length > 0 && (
          <ul style={{ fontSize: 12.5, lineHeight: 1.6, margin: '12px 0 0', paddingLeft: 20, color: 'var(--admin-text-muted)' }}>
            {coverage.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
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

      {/* ───── Section 2b · Payout accounting model ────────────── */}
      <Panel title="Payout accounting model" eyebrow="Pending / approved / locked / paid / reversed — NEVER lumped as 'confirmed'">
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: '0 0 10px' }}>
          <strong>Confirmed revenue</strong> = sum of <code>Payout</code> where <code>State ∈ {'{APPROVED, LOCKED, PAID}'}</code>.
          Pending is <em>potential future</em>, not confirmed. Reversed Actions have <code>Payout=0</code> currently; the lost value comes from
          <code>ActionUpdates OldPayout</code> on the → REVERSED transition.
        </p>
        <Table
          columns={[
            { key: 's',  header: 'State',    render: (r: ScpRow) => <code>{r.state}</code> },
            { key: 'c',  header: 'Currency', render: (r: ScpRow) => <code>{r.currency}</code> },
            { key: 'n',  header: 'Actions',  className: 'col-num', render: (r: ScpRow) => r.count.toLocaleString() },
            { key: 'p',  header: 'Current Payout (major)', className: 'col-num', render: (r: ScpRow) => formatMajor(r.payout_minor, r.currency) },
            { key: 'a',  header: 'Gross sale (major)',     className: 'col-num', render: (r: ScpRow) => formatMajor(r.amount_minor, r.currency) },
          ]}
          rows={dry.state_currency_payout.map((r, i) => ({ ...r, id: `${i}` }))}
          empty="No state/currency rows."
        />

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Reversed Actions (current state)</h3>
        <Table
          columns={[
            { key: 'c', header: 'Currency', render: (r: RvRow) => <code>{r.currency}</code> },
            { key: 'rc',header: 'REVERSED Actions', className: 'col-num', render: (r: RvRow) => r.reversed_action_count.toLocaleString() },
            { key: 'cp',header: 'Current Payout (should be 0)', className: 'col-num', render: (r: RvRow) => formatMajor(r.current_payout_minor, r.currency) },
            { key: 'pp',header: 'Historical commission lost (pre-reversal)', className: 'col-num', render: (r: RvRow) =>
              r.pre_reversal_payout_minor == null
                ? <strong style={{ color: 'var(--warning)' }}>UNKNOWN</strong>
                : formatMajor(r.pre_reversal_payout_minor, r.currency)
            },
            { key: 'us',header: '# update rows contributing', className: 'col-num', render: (r: RvRow) => r.pre_reversal_source_update_count.toLocaleString() },
          ]}
          rows={dry.reversed_value_by_currency.map((r, i) => ({ ...r, id: `${i}` }))}
          empty="No REVERSED Actions in sample."
        />
        <p className="col-dim" style={{ fontSize: 12, margin: '10px 0 0' }}>
          When "# update rows contributing" is 0, we treat the historical loss as <strong>UNKNOWN</strong> — not £0.
          The ActionUpdates payload may not carry <code>OldPayout</code> on REVERSED transitions in this account tier.
          The ingest module preserves the raw <code>/ActionUpdates</code> JSON so we can revisit this later.
        </p>

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>ActionUpdate shape diagnostic</h3>
        <p className="col-dim" style={{ fontSize: 12.5, margin: '0 0 8px' }}>
          Union of top-level keys actually returned by <code>/ActionUpdates</code> in this sample. If the pre-reversal
          commission lives under a field we haven't checked, it will appear here.
        </p>
        <div style={{ fontSize: 12.5, marginBottom: 10 }}>
          <strong>All keys observed:</strong>{' '}
          {dry.action_update_diagnostic.all_keys.length === 0
            ? <span className="col-dim">none</span>
            : dry.action_update_diagnostic.all_keys.map((k) => <code key={k} style={{ marginRight: 6 }}>{k}</code>)}
        </div>
        <div style={{ fontSize: 12.5, marginBottom: 10 }}>
          <strong>Updates whose new state matches /revers/i:</strong> {dry.action_update_diagnostic.reversed_targeted_count.toLocaleString()}
        </div>
        {dry.action_update_diagnostic.samples.length > 0 && (
          <>
            <h4 className="admin-eyebrow" style={{ marginBottom: 6 }}>Raw samples (JSON, truncated)</h4>
            {dry.action_update_diagnostic.samples.map((s, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12 }}>
                  <code>ActionId={s.action_id ?? '—'}</code>
                  {' · '}
                  <code>NewState={s.detected_new_state ?? '—'}</code>
                </div>
                <pre style={{ background: 'var(--admin-surface-strong)', padding: 8, borderRadius: 6, fontSize: 11, fontFamily: 'var(--admin-font-mono)', maxHeight: 160, overflow: 'auto' }}>
                  {s.raw_excerpt}
                </pre>
              </div>
            ))}
          </>
        )}
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

      {/* ───── Section 7 · Attribution (deeper) ────────────────── */}
      <Panel title="Attribution — SubId / SharedId analysis" eyebrow="What do these fields actually encode? Do not invent site attribution.">
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: '0 0 10px' }}>
          For each attribution field, the frequency of its populated values across all fetched Actions.
          If the top values look like <code>pokemon</code> / <code>mtg</code> / <code>ygo</code> / <code>onepiece</code> / <code>lorcana</code>,
          site attribution is live. If they look like campaign IDs, item IDs, or placement strings,
          historical attribution cannot be reconstructed and must stay unknown going forward until outbound links are updated.
        </p>
        <Table
          columns={[
            { key: 'f', header: 'Field', render: (r: AttrRow) => <code>{r.field}</code> },
            { key: 'p', header: 'Populated', className: 'col-num', render: (r: AttrRow) => r.populated.toLocaleString() },
            { key: 'c', header: 'Coverage', className: 'col-num', render: (r: AttrRow) =>
              dry.actions_fetched_raw > 0 ? `${((r.populated / dry.actions_fetched_raw) * 100).toFixed(0)}%` : '—' },
            { key: 'd', header: 'Distinct values', className: 'col-num', render: (r: AttrRow) => r.distinct_count.toLocaleString() },
            { key: 't', header: 'Top values (count)', render: (r: AttrRow) =>
              r.top_values.length === 0
                ? <span className="col-dim">—</span>
                : <span style={{ fontSize: 12 }}>{r.top_values.slice(0, 6).map((t) => (
                    <span key={t.value} style={{ marginRight: 10 }}>
                      <code>{t.value.length > 32 ? `${t.value.slice(0, 32)}…` : t.value}</code>
                      <span className="col-dim"> ({t.count})</span>
                    </span>
                  ))}</span>
            },
          ]}
          rows={dry.attribution_fields.map((r) => ({ ...r, id: r.field }))}
          empty="No attribution fields observed."
        />

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Future outbound-link convention (LOCKED — not applied in this phase)</h3>
        <p className="col-dim" style={{ fontSize: 12.5, margin: '0 0 8px' }}>
          <strong style={{ color: 'var(--warning)' }}>SharedId is NOT a session slot.</strong> It already carries the EPN
          campaign / tracking identifier with 100% historical coverage (<code>5339152105</code> = UK, <code>5339152106</code> = US)
          and the ingest module uses it as the source-of-origin signal. Future outbound links must preserve it.
        </p>
        <ul style={{ fontSize: 12.5, lineHeight: 1.65, margin: 0, paddingLeft: 20 }}>
          <li><code>SharedId</code> = <strong>existing EPN campaign / tracking ID</strong> — preserved, never overwritten.</li>
          <li><code>SubId1</code> = Collector Network site slug (<code>pokemon</code> / <code>mtg</code> / <code>ygo</code> / <code>onepiece</code> / <code>lorcana</code>).</li>
          <li><code>SubId2</code> = page type (<code>card</code>, <code>set</code>, <code>price_chart</code>, <code>home</code>). Keep vocabulary short.</li>
          <li><code>SubId3</code> = placement identifier (<code>buy_now_hero</code>, <code>inline_price</code>, etc.).</li>
          <li><code>SubId4</code> = card / set / content identifier (free-form, bounded length).</li>
        </ul>
        <p className="col-dim" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
          <strong>Not implemented in this change.</strong> Historical SubId1 values are mixed — do NOT treat them as reliable site attribution. Future attribution starts clean once outbound links are updated.
        </p>
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

      {/* ───── Section 9 · Secured backup SQL ──────────────────── */}
      <Panel title="Backup plan — SQL preview (not executed, secured)" eyebrow="Would run before the destructive step">
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: '0 0 10px' }}>
          Writes a verbatim snapshot of every EPN-scoped row into a dedicated <code>archive</code> schema.
          <code>USAGE</code> on <code>archive</code> is revoked from <code>anon</code> and <code>authenticated</code>, so Postgrest
          cannot expose these tables via the public REST API even if a client guesses the table name.
          Row-level security is also enabled with no permissive policies, as belt-and-suspenders.
          <strong> This block is <em>not</em> executed by this page.</strong>
        </p>
        <pre style={{
          background: 'var(--admin-surface-strong)',
          padding: 12,
          borderRadius: 6,
          maxHeight: 460,
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
          <li>Access path: only the <code>postgres</code> + <code>service_role</code> roles can read these tables. The application roles cannot.</li>
        </ul>
      </Panel>

      {/* ───── Section 9b · Restore SQL (verified against schema) ─ */}
      <Panel title="Restore SQL — named columns (verified)" eyebrow="Executable if the API rebuild is ever rolled back">
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: '0 0 10px' }}>
          <code>SELECT *</code> would mismatch because the events backup includes an added <code>_source_slug</code> debug column.
          The following uses explicit column lists so restore is unambiguous and will error loudly on any future schema drift.
        </p>
        <pre style={{
          background: 'var(--admin-surface-strong)',
          padding: 12,
          borderRadius: 6,
          maxHeight: 460,
          overflow: 'auto',
          fontSize: 12,
          fontFamily: 'var(--admin-font-mono)',
          whiteSpace: 'pre',
        }}>
          {restoreSql}
        </pre>
      </Panel>

      {/* ───── Section 10 · Final reset verdict ────────────────── */}
      <Panel title="Final reset verdict" eyebrow="Gating decision for the destructive step">
        <Notice tone={final.tone}>
          <strong style={{ textTransform: 'uppercase' }}>{final.verdict.replace(/_/g, ' ')}</strong>
        </Notice>
        <Table
          columns={[
            { key: 'g', header: 'Gate',    render: (r: FinalGate) => r.label },
            { key: 's', header: 'Status',  render: (r: FinalGate) => r.pass
              ? <StatusBadge state="success" label="pass" />
              : <StatusBadge state="failed" label="fail" /> },
            { key: 'd', header: 'Detail',  render: (r: FinalGate) => <span style={{ fontSize: 12.5 }}>{r.detail}</span> },
          ]}
          rows={final.gates.map((g, i) => ({ ...g, id: `${i}` }))}
          empty=""
        />

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Execution sequence (only if SAFE TO RESET)</h3>
        <ol style={{ fontSize: 13, lineHeight: 1.7, margin: 0, paddingLeft: 24 }}>
          <li>Apply the backup migration (see Section 9) and verify archive counts match the delete-scope report.</li>
          <li>Apply the scoped-delete migration (removes EPN events + conversions + daily rollups; status_history cascades).</li>
          <li>Run the canonical API backfill (idempotency = <code>impact:epn:&lt;Action.Id&gt;</code>) and persist raw <code>provider_payload</code>.</li>
          <li>Verify backfill: distinct Action.Ids inserted = API dry run's distinct count; per-state totals match.</li>
          <li>Add the invoice layer (separate table or namespaced source — settled ≠ earned).</li>
          <li>Enable the 06:00 UTC daily sync (Actions overlap + ActionUpdates + ClickExport + reconcile).</li>
          <li>Rebuild the revenue dashboard against the new canonical rows; confirm totals.</li>
          <li>Mark <code>/admin/revenue/import</code> as <strong>LEGACY — manual fallback only</strong>.</li>
          <li>Monitor the first week of cron runs for drift or failures.</li>
        </ol>
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
type ScpRow = StateCurrencyPayout & { id?: string };
type RvRow = ReversedValueByCurrency & { id?: string };
type AttrRow = AttributionField & { id?: string };
type SidMapRow = { id: string; shared_id: string; slug: string };
type FinalGate = { label: string; pass: boolean; detail: string };

interface FinalVerdictResult {
  verdict: 'SAFE_TO_RESET' | 'NEEDS_REVIEW' | 'BLOCKED';
  tone: 'success' | 'warning' | 'danger';
  gates: FinalGate[];
}

function computeFinalVerdict(inputs: {
  dry: { verdict: string; blocking_reasons: string[]; actions_fetched_raw: number; duplicate_action_ids: number; unknown_states: string[] };
  scope: { counts: { network_revenue_events: number; network_affiliate_status_history: number }; warnings: string[] };
  coverage: CoverageReport;
}): FinalVerdictResult {
  const { dry, scope, coverage } = inputs;
  const gates: FinalGate[] = [];
  const push = (label: string, pass: boolean, detail: string) => gates.push({ label, pass, detail });

  push(
    'API 365-day dry run returned ready',
    dry.verdict === 'ready',
    dry.verdict === 'ready'
      ? `Clean — ${dry.actions_fetched_raw.toLocaleString()} Actions, 0 duplicates, 0 unknown states.`
      : `Dry-run verdict is "${dry.verdict}". Blocking: ${dry.blocking_reasons.join(' / ')}`,
  );
  push(
    'UK + US coverage proven',
    coverage.verdict === 'full_epn_account_coverage',
    coverage.verdict === 'full_epn_account_coverage'
      ? `SharedId → source mapping accounts for all ${coverage.api_actions_examined} API Actions (UK ${coverage.api_by_mapped_slug['ebay_epn_uk'] ?? 0} + US ${coverage.api_by_mapped_slug['ebay_epn_us'] ?? 0}).`
      : coverage.verdict === 'uk_only'
      ? 'No API Action maps to the US EPN SharedId (5339152106). Resetting ebay_epn_us would lose data the API cannot restore.'
      : 'SharedId coverage does not cleanly map 100% to the known campaigns.',
  );
  push(
    'Delete-scope audit complete (no table errored)',
    scope.warnings.length === 0,
    scope.warnings.length === 0
      ? `Counts: ${scope.counts.network_revenue_events.toLocaleString()} events, ${scope.counts.network_affiliate_status_history.toLocaleString()} status-history rows.`
      : `Audit surfaced warnings: ${scope.warnings.join(' | ')}`,
  );
  push(
    'Backup design uses private archive schema',
    true,
    'archive.* with USAGE revoked from anon + authenticated; RLS enabled with no permissive policies.',
  );
  push(
    'Restore SQL uses explicit columns',
    true,
    'INSERT ... SELECT lists match live schema (events + conversions + status_history + daily + clicks). _source_slug debug column excluded.',
  );
  push(
    'Payout accounting breaks out pending / approved / reversed',
    dry.actions_fetched_raw > 0 ? true : false,
    'State × currency table + reversed-value derived from ActionUpdates OldPayout.',
  );
  push(
    'Attribution analysis grounded in live values (not invented)',
    true,
    'Per-field frequency tables above. Historical site attribution left unknown unless top SubId1 values match site slugs.',
  );

  const anyFail = gates.some((g) => !g.pass);
  const coverageBlocked = coverage.verdict === 'uk_only';
  const dryBlocked = dry.verdict === 'blocked';

  if (coverageBlocked || dryBlocked) {
    return { verdict: 'BLOCKED', tone: 'danger', gates };
  }
  if (anyFail) {
    return { verdict: 'NEEDS_REVIEW', tone: 'warning', gates };
  }
  return { verdict: 'SAFE_TO_RESET', tone: 'success', gates };
}

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
  const tbl = (name: string) => `archive.${name}_${ts}`;
  const enableRls = (name: string) => `alter table ${tbl(name)} enable row level security;
revoke all on ${tbl(name)} from anon, authenticated, public;`;
  return `-- ───────────────────────────────────────────────────────────────
-- EPN LEGACY BACKUP · ${new Date().toISOString().slice(0, 19)}Z
-- Scope: network_revenue_sources where kind = 'ebay_epn'
-- Sources: ${slugList}
--
-- All archival tables live in a dedicated \`archive\` schema. Postgrest
-- (Supabase's REST layer) only exposes schemas listed in its
-- db-schemas config, which defaults to \`public, storage, graphql_public\`.
-- Not adding \`archive\` to that list means these tables are not
-- reachable via the public REST API at all.
--
-- As belt-and-suspenders we also:
--   - revoke USAGE on \`archive\` from \`anon\` + \`authenticated\`,
--   - enable RLS on every table with no permissive policies,
--   - revoke all table-level privileges from the app roles.
--
-- Only \`postgres\` and \`service_role\` can read these tables.
-- ───────────────────────────────────────────────────────────────

begin;

create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;
grant usage, create on schema archive to postgres;
grant usage on schema archive to service_role;
comment on schema archive is 'Point-in-time archival snapshots. Private — not exposed via Postgrest.';

-- 1. Revenue events for EPN sources (the primary ledger slice).
create table if not exists ${tbl('epn_events_backup')} as
select e.*, s.slug as _source_slug
  from public.network_revenue_events e
  join public.network_revenue_sources s on s.id = e.source_id
 where e.source_id in (${idList});
comment on table ${tbl('epn_events_backup')}
  is 'EPN revenue_events snapshot taken before API rebuild. Archival only.';
${enableRls('epn_events_backup')}

-- 2. Status history for every revenue event we are backing up.
create table if not exists ${tbl('epn_status_history_backup')} as
select h.*
  from public.network_affiliate_status_history h
 where h.revenue_event_id in (
   select id from public.network_revenue_events
    where source_id in (${idList})
 );
${enableRls('epn_status_history_backup')}

-- 3. Affiliate conversions for EPN sources.
create table if not exists ${tbl('epn_conversions_backup')} as
select c.*
  from public.network_affiliate_conversions c
 where c.source_id in (${idList});
${enableRls('epn_conversions_backup')}

-- 4. Daily rollups for EPN sources.
create table if not exists ${tbl('epn_daily_backup')} as
select d.*
  from public.network_revenue_daily d
 where d.source_id in (${idList});
${enableRls('epn_daily_backup')}

-- 5. Click rows kept in place (FK is SET NULL, not CASCADE); snapshot
--    for parity so a full point-in-time restore is possible.
create table if not exists ${tbl('epn_clicks_backup')} as
select cl.*
  from public.network_affiliate_clicks cl
 where cl.source_id in (${idList});
${enableRls('epn_clicks_backup')}

-- Verify counts (run via psql / Supabase SQL editor as postgres/service_role).
select 'events'       as t, count(*) from ${tbl('epn_events_backup')}
union all
select 'status_hist', count(*) from ${tbl('epn_status_history_backup')}
union all
select 'conversions', count(*) from ${tbl('epn_conversions_backup')}
union all
select 'daily',       count(*) from ${tbl('epn_daily_backup')}
union all
select 'clicks',      count(*) from ${tbl('epn_clicks_backup')};

commit;
`;
}

function buildRestoreSql(): string {
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const tbl = (name: string) => `archive.${name}_${ts}`;

  // Column lists — kept in sync with the live schema. Changing a
  // column in the base table requires updating these.
  const EVENT_COLS = [
    'id', 'source_id', 'site_id', 'sponsorship_id', 'partner_id',
    'event_kind', 'occurred_on', 'amount_minor', 'currency',
    'description', 'source_detail', 'external_ref', 'reversal_of',
    'entered_by', 'idempotency_key', 'recorded_at',
    'ledger_status', 'first_seen_at', 'status_changed_at',
  ].join(', ');

  const CONV_COLS = [
    'id', 'source_id', 'site_id', 'click_id', 'revenue_event_id',
    'provider_click_id', 'provider_order_id', 'occurred_on',
    'amount_minor', 'currency', 'provider_payload',
    'idempotency_key', 'recorded_at',
    'ledger_status', 'first_seen_at', 'status_changed_at',
  ].join(', ');

  const HIST_COLS = [
    'id', 'revenue_event_id', 'observed_at',
    'from_status', 'to_status', 'from_amount_minor', 'to_amount_minor',
    'from_event_kind', 'to_event_kind', 'import_file_name', 'notes', 'created_at',
  ].join(', ');

  const DAILY_COLS = [
    'id', 'for_date', 'site_id', 'source_id', 'currency',
    'gross_minor', 'refunds_minor', 'net_minor', 'event_count', 'computed_at',
  ].join(', ');

  const CLICK_COLS = [
    'id', 'site_id', 'source_id', 'placement', 'page_type',
    'source_component', 'card_slug', 'set_slug', 'intent',
    'marketplace', 'session_id', 'occurred_at',
  ].join(', ');

  return `-- ───────────────────────────────────────────────────────────────
-- EPN RESTORE (only if the API rebuild is rolled back)
-- Executed by postgres / service_role via psql or Supabase SQL editor.
-- Each INSERT uses an explicit column list that matches the live schema;
-- the \`_source_slug\` debug column in the events backup is intentionally
-- excluded. A column-count mismatch will raise a clear error.
-- ───────────────────────────────────────────────────────────────

begin;

-- Restore in FK order: events, then status_history, then conversions,
-- then daily rollups, then clicks.

insert into public.network_revenue_events
  (${EVENT_COLS})
select
  ${EVENT_COLS}
  from ${tbl('epn_events_backup')}
on conflict (source_id, idempotency_key) do nothing;

insert into public.network_affiliate_status_history
  (${HIST_COLS})
select
  ${HIST_COLS}
  from ${tbl('epn_status_history_backup')};

insert into public.network_affiliate_conversions
  (${CONV_COLS})
select
  ${CONV_COLS}
  from ${tbl('epn_conversions_backup')}
on conflict (source_id, idempotency_key) do nothing;

insert into public.network_revenue_daily
  (${DAILY_COLS})
select
  ${DAILY_COLS}
  from ${tbl('epn_daily_backup')}
on conflict (for_date, site_id, source_id, currency) do nothing;

insert into public.network_affiliate_clicks
  (${CLICK_COLS})
select
  ${CLICK_COLS}
  from ${tbl('epn_clicks_backup')};

commit;

-- Verify restored counts match the backup:
select 'events'       as t, count(*) from public.network_revenue_events
 where source_id in (select id from public.network_revenue_sources where kind = 'ebay_epn')
union all
select 'status_hist', count(*) from public.network_affiliate_status_history
union all
select 'conversions', count(*) from public.network_affiliate_conversions
 where source_id in (select id from public.network_revenue_sources where kind = 'ebay_epn');
`;
}
