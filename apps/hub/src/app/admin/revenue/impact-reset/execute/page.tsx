import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { auditCurrentEpnLedger, type CurrentLedgerAudit } from '@/server/impact/current-ledger-audit';
import { runDryRun } from '@/server/impact/dry-run';
import type { IngestResult } from '@/server/impact/ingest';
import {
  executeImpactBackfillAction,
  executeImpactDailySyncAction,
  executeImpactInvoiceSyncAction,
  reconstructCanonicalBackfillJobAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// 365-day backfill may take ~1-3 min on a cold run.
export const maxDuration = 300;

export default async function ImpactResetExecutorPage() {
  const { admin, sb } = await requireAdmin('/admin/revenue/impact-reset/execute');
  const sites = await listNetworkSites(sb);

  // Current EPN event count + per-slug split (the status line).
  const { data: srcData } = await sb
    .from('network_revenue_sources')
    .select('id, slug, display_name')
    .eq('kind', 'ebay_epn');
  const sources = (srcData ?? []) as Array<{ id: string; slug: string; display_name: string }>;
  const sourceIds = sources.map((s) => s.id);
  const slugById = new Map(sources.map((s) => [s.id, s.slug]));

  let currentEpnEvents = 0;
  const perSlugCount: Record<string, number> = {};
  if (sourceIds.length > 0) {
    const { count } = await sb
      .from('network_revenue_events')
      .select('*', { count: 'exact', head: true })
      .in('source_id', sourceIds);
    currentEpnEvents = count ?? 0;

    // Per-slug via one small aggregation — ~453 rows total.
    const { data: rows } = await sb
      .from('network_revenue_events')
      .select('source_id')
      .in('source_id', sourceIds)
      .limit(2000);
    for (const r of (rows ?? []) as Array<{ source_id: string }>) {
      const slug = slugById.get(r.source_id) ?? '(unknown)';
      perSlugCount[slug] = (perSlugCount[slug] ?? 0) + 1;
    }
  }

  // Latest completed sync + backfill from network_job_runs.
  const { data: lastSyncRows } = await sb
    .from('network_job_runs')
    .select('job_name, status, started_at, finished_at')
    .in('job_name', ['impact.epn.sync', 'impact.epn.backfill'])
    .in('status', ['success', 'warning', 'partial'])
    .order('finished_at', { ascending: false })
    .limit(5);
  const lastSync = ((lastSyncRows ?? []) as Array<{ job_name: string; status: string; started_at: string | null; finished_at: string | null }>)[0] ?? null;

  // Invoice-table presence check.
  const { count: invoiceCount } = await sb
    .from('network_affiliate_invoices')
    .select('*', { count: 'exact', head: true });

  // Read-only diagnostic — runs on every page load. Fetches a fresh
  // Impact dry run (so we can compare live-API vs ledger) and runs
  // the ledger-shape audit.
  const dry = await runDryRun().catch((err) => {
    return { raw_actions: [], skipped_reason: err instanceof Error ? err.message : String(err) } as unknown as Awaited<ReturnType<typeof runDryRun>>;
  });
  const audit = await auditCurrentEpnLedger(sb, dry.raw_actions ?? null);

  const apiMatchPct = audit.api_comparison && audit.api_comparison.ledger_action_count > 0
    ? (audit.api_comparison.both / audit.api_comparison.ledger_action_count) * 100
    : null;

  const healthy = currentEpnEvents > 0
    && (audit.shape.by_idempotency_prefix['impact:epn'] ?? 0) === currentEpnEvents
    && (apiMatchPct ?? 0) >= 99;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue/impact-reset/execute">
      <SectionHeader
        eyebrow="Revenue · EPN API ingest"
        title="EPN API ingest · Operations"
        description={<>Canonical ledger is maintained by the daily cron and the on-demand actions below. Diagnostic + reset tooling is behind the Advanced disclosure.</>}
      />

      <Panel title="EPN API status" eyebrow={healthy ? 'Canonical ledger active' : 'Attention'}>
        <Notice tone={healthy ? 'success' : 'warning'}>
          <strong style={{ textTransform: 'uppercase' }}>
            {healthy ? 'Canonical ledger active' : 'Ledger ↔ API out of sync'}
          </strong>
          {' · '}
          {currentEpnEvents.toLocaleString()} current Actions
          {apiMatchPct != null && <> · ledger / API match {apiMatchPct.toFixed(0)}%</>}
        </Notice>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
          <KV label="Current Actions" value={currentEpnEvents.toLocaleString()} />
          <KV label="US campaign (ebay_epn_us)" value={(perSlugCount['ebay_epn_us'] ?? 0).toLocaleString()} />
          <KV label="UK campaign (ebay_epn_uk)" value={(perSlugCount['ebay_epn_uk'] ?? 0).toLocaleString()} />
          <KV
            label="Last API sync"
            value={lastSync?.finished_at ? new Date(lastSync.finished_at).toISOString() : '(none recorded)'}
          />
          <KV label="Next scheduled sync" value="06:00 UTC daily (/api/sync/impact-epn)" />
          <KV
            label="Ledger ↔ API match"
            value={apiMatchPct != null ? `${apiMatchPct.toFixed(1)}%` : '—'}
            warn={apiMatchPct != null && apiMatchPct < 99}
          />
          <KV label="Invoice rows" value={(invoiceCount ?? 0).toLocaleString()} />
        </div>
      </Panel>

      <DiagnosticPanel audit={audit} />

      <details style={{ background: 'var(--admin-surface)', border: '1px solid var(--admin-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
        <summary style={{ fontSize: 13, fontWeight: 700, cursor: 'pointer', color: 'var(--admin-text)' }}>
          Advanced / Recovery
        </summary>
        <p className="col-dim" style={{ fontSize: 12.5, margin: '8px 0 16px' }}>
          Manual operations. The daily cron handles routine sync — these are only needed to repair state, backfill history,
          or trigger a one-off run. The 365-day backfill in particular rarely needs to run after the initial cutover.
        </p>

        <Panel title="Manual sync" eyebrow="Idempotent · writes to network_job_runs">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <form action={executeImpactDailySyncAction}>
              <button type="submit" className="admin-btn" style={{ padding: '8px 14px', fontSize: 13 }}>
                Run 7-day sync now
              </button>
            </form>
            <form action={executeImpactInvoiceSyncAction}>
              <button type="submit" className="admin-btn" style={{ padding: '8px 14px', fontSize: 13 }}>
                Sync invoices now
              </button>
            </form>
          </div>
          <p className="col-dim" style={{ fontSize: 12, margin: '8px 0 0' }}>
            Both appear in <code>/admin/jobs</code> on completion.
          </p>
        </Panel>

        <Panel title="365-day backfill" eyebrow="Requires confirmation — rarely needed">
          <Notice tone="warning">
            Re-fetches the entire Impact Action history. Idempotent (keyed by <code>impact:epn:&lt;Action.Id&gt;</code>),
            so it will not duplicate data, but it takes ~1–3 min and consumes Impact API quota.
          </Notice>
          <form action={executeImpactBackfillAction} style={{ marginTop: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 10 }}>
              <input type="checkbox" name="confirm" required />
              <span>I understand this re-fetches 365 days of Actions. The ledger is already canonical — this is a recovery operation.</span>
            </label>
            <button type="submit" className="admin-btn admin-btn-primary" style={{ padding: '8px 14px', fontSize: 13 }}>
              Execute 365-day backfill
            </button>
          </form>
        </Panel>

        <Panel title="Metadata reconstruction (one-time)" eyebrow="For the pre-registry ingest that did not log a job_run">
          <p style={{ fontSize: 13, lineHeight: 1.6, margin: '0 0 10px' }}>
            Writes a <code>network_job_runs</code> row explicitly marked <code>trigger=reconstructed</code> whose
            <code>started_at</code> is the min <code>first_seen_at</code> of canonical rows. Clearly a reconstruction,
            not a fabrication. Safe to click once; subsequent clicks are no-ops (duplicate-check via metadata).
          </p>
          <form action={reconstructCanonicalBackfillJobAction}>
            <button type="submit" className="admin-btn" style={{ padding: '8px 14px', fontSize: 13 }}>
              Reconstruct job_run from ledger
            </button>
          </form>
        </Panel>
      </details>
    </AdminShell>
  );
}

function ResultPanel({ title, result }: { title: string; result: IngestResult }) {
  const tone =
    result.errors.length > 0 ? 'danger' :
    result.warnings.length > 0 ? 'warning' :
    'success';
  return (
    <Panel title={title} eyebrow={`Ran at ${result.ran_at}`}>
      <Notice tone={tone}>
        {result.skipped_reason
          ? <><strong>Skipped.</strong> {result.skipped_reason}</>
          : result.errors.length > 0
          ? <><strong>Errors.</strong> {result.errors[0]}</>
          : <><strong>Complete.</strong> {result.actions_upserted.toLocaleString()} Actions upserted ({result.actions_inserted.toLocaleString()} inserted, {result.actions_updated.toLocaleString()} updated).</>}
      </Notice>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>
        <KV label="Window size" value={`${result.window_days}d`} />
        <KV label="Total days" value={`${result.total_days}d`} />
        <KV label="Windows" value={result.windows.length.toLocaleString()} />
        <KV label="API calls" value={result.total_api_calls.toLocaleString()} />
        <KV label="Actions seen" value={result.actions_seen.toLocaleString()} />
        <KV label="Rejected (unknown SharedId)" value={result.actions_rejected_unknown_shared_id.toLocaleString()} warn={result.actions_rejected_unknown_shared_id > 0} />
        <KV label="Rejected (missing fields)" value={result.actions_rejected_missing_critical_fields.toLocaleString()} warn={result.actions_rejected_missing_critical_fields > 0} />
        <KV label="Upserted" value={result.actions_upserted.toLocaleString()} />
        <KV label="Inserted" value={result.actions_inserted.toLocaleString()} />
        <KV label="Updated (status change)" value={result.actions_updated.toLocaleString()} />
        <KV label="Status history rows added" value={result.status_history_rows_inserted.toLocaleString()} />
      </div>

      <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Per-source ingest summary</h3>
      <Table
        columns={[
          { key: 's',  header: 'Slug',      render: (r: BySlugRow) => <code>{r.slug}</code> },
          { key: 'in', header: 'Ingested',  className: 'col-num', render: (r: BySlugRow) => r.ingested.toLocaleString() },
          { key: 'pe', header: 'Pending',   className: 'col-num', render: (r: BySlugRow) => r.pending.toLocaleString() },
          { key: 'co', header: 'Confirmed', className: 'col-num', render: (r: BySlugRow) => r.confirmed.toLocaleString() },
          { key: 're', header: 'Reversed',  className: 'col-num', render: (r: BySlugRow) => r.reversed.toLocaleString() },
          { key: 'py', header: 'Payout (sum, minor)', className: 'col-num', render: (r: BySlugRow) => r.payout_minor.toLocaleString() },
          { key: 'am', header: 'Current amount (sum, minor)', className: 'col-num', render: (r: BySlugRow) => r.amount_minor.toLocaleString() },
        ]}
        rows={Object.entries(result.by_slug).map(([slug, v]) => ({ ...v, slug, id: slug }))}
        empty="No per-slug data."
      />

      <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Per-window</h3>
      <Table
        columns={[
          { key: 'r',  header: 'Range',   render: (r: WinRow) => <code>{r.start} → {r.end}</code> },
          { key: 'st', header: 'Status',  render: (r: WinRow) => r.status === 'ok' ? <StatusBadge state="success" label="ok" /> : r.status === 'partial' ? <StatusBadge state="warning" label="partial" /> : <StatusBadge state="failed" label="failed" /> },
          { key: 'af', header: 'Actions', className: 'col-num', render: (r: WinRow) => r.actions_fetched.toLocaleString() },
          { key: 'uf', header: 'ActionUpdates', className: 'col-num', render: (r: WinRow) => r.action_updates_fetched.toLocaleString() },
          { key: 'd',  header: 'Duration', className: 'col-num', render: (r: WinRow) => `${(r.duration_ms / 1000).toFixed(1)}s` },
          { key: 'e',  header: 'Error',   render: (r: WinRow) => r.error ? <code style={{ fontSize: 11 }}>{r.error}</code> : <span className="col-dim">—</span> },
        ]}
        rows={result.windows.map((w, i) => ({ ...w, id: `${i}` }))}
        empty="No windows."
      />

      {(result.warnings.length > 0 || result.errors.length > 0) && (
        <div style={{ marginTop: 12 }}>
          {result.errors.length > 0 && (
            <>
              <h3 className="admin-eyebrow" style={{ marginBottom: 4 }}>Errors</h3>
              <ul style={{ fontSize: 12.5, margin: 0, paddingLeft: 20, color: 'var(--danger)' }}>
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </>
          )}
          {result.warnings.length > 0 && (
            <>
              <h3 className="admin-eyebrow" style={{ marginTop: 8, marginBottom: 4 }}>Warnings</h3>
              <ul style={{ fontSize: 12.5, margin: 0, paddingLeft: 20, color: 'var(--admin-text-muted)' }}>
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

type BySlugRow = IngestResult['by_slug'][string] & { slug: string; id?: string };
type WinRow = IngestResult['windows'][number] & { id?: string };

function DiagnosticPanel({ audit }: { audit: CurrentLedgerAudit }) {
  const s = audit.shape;
  const canonical = s.by_idempotency_prefix['impact:epn'] ?? 0;
  const other = s.total - canonical;
  const cmp = audit.api_comparison;

  const diagnosisLines: string[] = [];
  if (s.total === 0) {
    diagnosisLines.push('Public EPN slice is empty. The reset migration deleted cleanly and no backfill has run yet.');
  } else {
    diagnosisLines.push(`Public EPN slice holds ${s.total} rows.`);
    if (canonical > 0 && other === 0) {
      diagnosisLines.push(`All ${canonical} rows carry idempotency_key starting "impact:epn:" → canonical ingest shape. Rows were written by the API ingest module, not by CSV import.`);
    } else if (canonical > 0 && other > 0) {
      diagnosisLines.push(`${canonical} rows are canonical (impact:epn:*); ${other} are not. Mixed state — investigate the non-canonical rows below.`);
    } else {
      diagnosisLines.push(`None of the ${s.total} rows carry the "impact:epn:" prefix. These are NOT from the canonical ingest.`);
    }
    if (cmp) {
      if (cmp.only_ledger === 0 && cmp.only_api === 0) {
        diagnosisLines.push(`Ledger ↔ API Action.Id sets match exactly (${cmp.both} on each side). Canonical backfill has effectively already occurred.`);
      } else {
        diagnosisLines.push(`Ledger ↔ API comparison: ${cmp.both} in both, ${cmp.only_api} only in API (unseen), ${cmp.only_ledger} only in ledger. Investigate the gaps.`);
      }
    }
    if (audit.impact_settings_rows.length === 0) {
      diagnosisLines.push('No network_settings row exists for impact_last_backfill / impact_last_daily_sync — the "Last backfill: (never)" display is literally true even though canonical rows exist. Most likely explanation: a previous server action ran the ingest but failed to upsert the settings row (RLS or write error that the action did not surface).');
    }
    if (audit.recent_impact_job_runs.length === 0) {
      diagnosisLines.push('No rows in network_job_runs with job_name matching impact/epn — nothing scheduled or manual has been logged. Confirms the daily cron has not yet fired (first fire is tonight at 06:00 UTC) AND the ingest that populated the current rows did not create a job_run record.');
    }
  }

  return (
    <Panel title={`Diagnostic — current ${s.total} EPN rows (read-only)`} eyebrow="Scoped to kind='ebay_epn'. All queries are SELECT-only.">
      <Notice tone={s.total === 0 ? 'info' : (canonical === s.total ? 'success' : 'warning')}>
        <strong>Shape:</strong> {s.total.toLocaleString()} rows · idempotency "impact:epn:" × {canonical.toLocaleString()} · other × {other.toLocaleString()}
        {cmp && <> · API Action.Id overlap {cmp.both}/{cmp.ledger_action_count} ledger, {cmp.both}/{cmp.api_action_count} API</>}
      </Notice>

      <h3 className="admin-eyebrow" style={{ marginTop: 12, marginBottom: 6 }}>Diagnosis</h3>
      <ul style={{ fontSize: 13, lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
        {diagnosisLines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>

      <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Ledger shape</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        <Bucket title="By source slug"              data={s.by_source_slug} />
        <Bucket title="By ledger_status"            data={s.by_ledger_status} />
        <Bucket title="By event_kind"               data={s.by_event_kind} />
        <Bucket title="By currency"                 data={s.by_currency} />
        <Bucket title="By idempotency prefix"       data={s.by_idempotency_prefix} />
        <Bucket title="By source_detail.shared_id"  data={s.by_shared_id_in_source_detail} />
      </div>

      <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Date ranges</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        <KV label="occurred_on" value={s.occurred_on_min && s.occurred_on_max ? `${s.occurred_on_min} → ${s.occurred_on_max}` : '—'} />
        <KV label="first_seen_at" value={s.first_seen_min && s.first_seen_max ? `${s.first_seen_min} → ${s.first_seen_max}` : '—'} />
        <KV label="recorded_at" value={s.recorded_at_min && s.recorded_at_max ? `${s.recorded_at_min} → ${s.recorded_at_max}` : '—'} />
        <KV label="Distinct external_ref" value={s.distinct_external_refs.toLocaleString()} />
        <KV label="Duplicate external_ref" value={s.duplicate_external_refs.toLocaleString()} warn={s.duplicate_external_refs > 0} />
        <KV label="provider_payload present (in source_detail)" value={`${s.provider_payload_present_count.toLocaleString()} / ${s.total.toLocaleString()}`} />
      </div>

      <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Payout totals by status (minor units)</h3>
      <Table
        columns={[
          { key: 'st', header: 'ledger_status', render: (r: StateCurrencyBucket) => <code>{r.state}</code> },
          { key: 'cc', header: 'Currency',      render: (r: StateCurrencyBucket) => <code>{r.currency}</code> },
          { key: 'am', header: 'Sum amount_minor', className: 'col-num', render: (r: StateCurrencyBucket) => r.sum.toLocaleString() },
        ]}
        rows={toStateCurrencyRows(s.payout_total_minor_by_status)}
        empty="No payout totals."
      />

      {cmp && (
        <>
          <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Ledger ↔ live-API comparison (by Action.Id = external_ref)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <KV label="API Action count" value={cmp.api_action_count.toLocaleString()} />
            <KV label="Ledger Action count" value={cmp.ledger_action_count.toLocaleString()} />
            <KV label="Both (overlap)" value={cmp.both.toLocaleString()} />
            <KV label="Only in API" value={cmp.only_api.toLocaleString()} warn={cmp.only_api > 0} />
            <KV label="Only in ledger" value={cmp.only_ledger.toLocaleString()} warn={cmp.only_ledger > 0} />
          </div>
        </>
      )}

      <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>network_job_runs (last 20 matching impact/epn)</h3>
      {audit.recent_impact_job_runs.length === 0 ? (
        <p className="col-dim" style={{ fontSize: 12.5, margin: 0 }}>No rows.</p>
      ) : (
        <Table
          columns={[
            { key: 'n',  header: 'job_name', render: (r: JobRunDisplay) => <code style={{ fontSize: 11 }}>{r.job_name}</code> },
            { key: 's',  header: 'status',   render: (r: JobRunDisplay) => <code>{r.status}</code> },
            { key: 'st', header: 'started_at', render: (r: JobRunDisplay) => <code style={{ fontSize: 11 }}>{r.started_at ?? '—'}</code> },
            { key: 'f',  header: 'finished_at', render: (r: JobRunDisplay) => <code style={{ fontSize: 11 }}>{r.finished_at ?? '—'}</code> },
            { key: 'ex', header: 'examined',   className: 'col-num', render: (r: JobRunDisplay) => (r.rows_examined ?? 0).toLocaleString() },
            { key: 'in', header: 'inserted',   className: 'col-num', render: (r: JobRunDisplay) => (r.rows_inserted ?? 0).toLocaleString() },
            { key: 'up', header: 'updated',    className: 'col-num', render: (r: JobRunDisplay) => (r.rows_updated ?? 0).toLocaleString() },
            { key: 'rj', header: 'rejected',   className: 'col-num', render: (r: JobRunDisplay) => (r.rows_rejected ?? 0).toLocaleString() },
            { key: 'er', header: 'error',      render: (r: JobRunDisplay) => r.error_summary ? <code style={{ fontSize: 11 }}>{r.error_summary}</code> : <span className="col-dim">—</span> },
          ]}
          rows={audit.recent_impact_job_runs.map((r) => ({ ...r }))}
          empty=""
        />
      )}

      <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>network_settings (impact/epn keys)</h3>
      {audit.impact_settings_rows.length === 0 ? (
        <p className="col-dim" style={{ fontSize: 12.5, margin: 0 }}>
          No row. The server action&apos;s <code>upsert</code> on <code>impact_last_backfill</code> never succeeded.
        </p>
      ) : (
        <Table
          columns={[
            { key: 'k', header: 'key',        render: (r: SettingsDisplay) => <code>{r.key}</code> },
            { key: 'u', header: 'updated_at', render: (r: SettingsDisplay) => <code style={{ fontSize: 11 }}>{r.updated_at ?? '—'}</code> },
            { key: 'v', header: 'value (summary)', render: (r: SettingsDisplay) => <code style={{ fontSize: 11 }}>{r.value_summary}</code> },
          ]}
          rows={audit.impact_settings_rows.map((r, i) => ({ ...r, id: `${i}` }))}
          empty=""
        />
      )}

      <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>network_audit_log (last 15 matching impact/epn)</h3>
      {audit.recent_impact_audit_log.length === 0 ? (
        <p className="col-dim" style={{ fontSize: 12.5, margin: 0 }}>No matching entries.</p>
      ) : (
        <Table
          columns={[
            { key: 't', header: 'occurred_at', render: (r: AuditLogDisplay) => <code style={{ fontSize: 11 }}>{r.occurred_at ?? '—'}</code> },
            { key: 'a', header: 'actor', render: (r: AuditLogDisplay) => <code style={{ fontSize: 11 }}>{r.actor ?? '—'}</code> },
            { key: 'c', header: 'action', render: (r: AuditLogDisplay) => <code style={{ fontSize: 11 }}>{r.action ?? '—'}</code> },
            { key: 'g', header: 'target', render: (r: AuditLogDisplay) => <code style={{ fontSize: 11 }}>{r.target ?? '—'}</code> },
            { key: 's', header: 'summary', render: (r: AuditLogDisplay) => <code style={{ fontSize: 11 }}>{r.summary}</code> },
          ]}
          rows={audit.recent_impact_audit_log.map((r) => ({ ...r }))}
          empty=""
        />
      )}

      {audit.warnings.length > 0 && (
        <ul style={{ fontSize: 12.5, lineHeight: 1.6, margin: '12px 0 0', paddingLeft: 20, color: 'var(--admin-text-muted)' }}>
          {audit.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </Panel>
  );
}

function Bucket({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ border: '1px solid var(--admin-border)', borderRadius: 'var(--radius-md)', padding: 10, background: 'var(--admin-surface)' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-subtle)', fontWeight: 700, marginBottom: 6 }}>{title}</div>
      {entries.length === 0 ? (
        <span className="col-dim" style={{ fontSize: 12 }}>empty</span>
      ) : (
        <ul style={{ fontSize: 12.5, margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>
          {entries.map(([k, n]) => (
            <li key={k}><code>{k}</code> × {n.toLocaleString()}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface StateCurrencyBucket { state: string; currency: string; sum: number; id: string }
function toStateCurrencyRows(data: Record<string, Record<string, number>>): StateCurrencyBucket[] {
  const rows: StateCurrencyBucket[] = [];
  let i = 0;
  for (const state of Object.keys(data).sort()) {
    const ccyMap = data[state] ?? {};
    for (const ccy of Object.keys(ccyMap).sort()) {
      rows.push({ state, currency: ccy, sum: ccyMap[ccy] ?? 0, id: `${i++}` });
    }
  }
  return rows;
}

type JobRunDisplay = CurrentLedgerAudit['recent_impact_job_runs'][number] & { id?: string };
type SettingsDisplay = CurrentLedgerAudit['impact_settings_rows'][number] & { id?: string };
type AuditLogDisplay = CurrentLedgerAudit['recent_impact_audit_log'][number] & { id?: string };

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
