import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import type { IngestResult } from '@/server/impact/ingest';
import { executeImpactBackfillAction, executeImpactDailySyncAction } from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// 365-day backfill may take ~1-3 min on a cold run.
export const maxDuration = 300;

export default async function ImpactResetExecutorPage() {
  const { admin, sb } = await requireAdmin('/admin/revenue/impact-reset/execute');
  const sites = await listNetworkSites(sb);

  // Pre-flight: current EPN event count + presence of archive backup tables.
  const { data: srcData } = await sb
    .from('network_revenue_sources')
    .select('id, slug, display_name')
    .eq('kind', 'ebay_epn');
  const sources = (srcData ?? []) as Array<{ id: string; slug: string; display_name: string }>;
  const sourceIds = sources.map((s) => s.id);

  let currentEpnEvents = 0;
  if (sourceIds.length > 0) {
    const { count } = await sb
      .from('network_revenue_events')
      .select('*', { count: 'exact', head: true })
      .in('source_id', sourceIds);
    currentEpnEvents = count ?? 0;
  }

  // Previous backfill result (if any).
  const { data: lastRow } = await sb
    .from('network_settings')
    .select('value, updated_at')
    .eq('key', 'impact_last_backfill')
    .maybeSingle();
  const lastResult = (lastRow?.value ?? null) as IngestResult | null;
  const lastUpdatedAt = (lastRow as { updated_at?: string } | null)?.updated_at ?? null;

  const { data: lastDailyRow } = await sb
    .from('network_settings')
    .select('value, updated_at')
    .eq('key', 'impact_last_daily_sync')
    .maybeSingle();
  const lastDaily = (lastDailyRow?.value ?? null) as IngestResult | null;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue/impact-reset/execute">
      <SectionHeader
        eyebrow="Revenue · Reset executor"
        title="Impact EPN canonical rebuild"
        description={
          <>
            Runs the 365-day Impact EPN backfill using the SharedId → source mapping documented on the reset gate.
            Idempotent — safe to run again. Does NOT touch non-EPN data.
          </>
        }
      />

      <Panel title="Pre-flight" eyebrow="State before running">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <KV label="EPN sources resolved" value={sources.length.toLocaleString()} warn={sources.length === 0} />
          <KV
            label="Current EPN events"
            value={currentEpnEvents.toLocaleString()}
            warn={currentEpnEvents > 0 && lastResult == null}
          />
          <KV label="Last backfill" value={lastUpdatedAt ? new Date(lastUpdatedAt).toISOString() : '(never)'} />
        </div>
        <ul style={{ fontSize: 12.5, lineHeight: 1.65, margin: '12px 0 0', paddingLeft: 20, color: 'var(--admin-text-muted)' }}>
          <li>Expect <code>Current EPN events = 0</code> after applying migration <code>20261006020000_epn_reset</code>.</li>
          <li>If &gt; 0 and no previous backfill, the reset migration has not been applied yet — do not click Execute until it is.</li>
          <li>If a previous backfill exists, Execute is safe: upserts are keyed by <code>impact:epn:&lt;Action.Id&gt;</code>.</li>
        </ul>
      </Panel>

      <Panel title="Execute" eyebrow="Server action — admin only">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <form action={executeImpactBackfillAction}>
            <button type="submit" className="admin-btn admin-btn-primary" style={{ padding: '10px 18px', fontSize: 14 }}>
              Execute 365-day backfill
            </button>
          </form>
          <form action={executeImpactDailySyncAction}>
            <button type="submit" className="admin-btn" style={{ padding: '10px 18px', fontSize: 14 }}>
              Run 7-day daily sync (manual)
            </button>
          </form>
        </div>
        <p className="col-dim" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
          Both are idempotent. The 365-day run may take 1–3 min on first run; the browser will wait.
          Results are stashed in <code>network_settings</code> and shown below after the run completes.
        </p>
      </Panel>

      {lastResult && <ResultPanel title="Latest 365-day backfill result" result={lastResult} />}
      {lastDaily && <ResultPanel title="Latest manual daily-sync result" result={lastDaily} />}
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
