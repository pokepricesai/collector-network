import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { runImpactAudit, type EndpointAudit } from '@/server/impact/audit';
import { runCrosswalk } from '@/server/impact/crosswalk';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

// Read-only Impact API audit. Admin-only, server-side only.

export default async function ImpactAuditPage() {
  const { admin, sb } = await requireAdmin('/admin/revenue/impact-audit');
  const sites = await listNetworkSites(sb);
  const [audit, crosswalk] = await Promise.all([
    runImpactAudit(),
    runCrosswalk(sb),
  ]);

  const verdictTone =
    audit.canReplaceCsv.verdict === 'yes' ? 'success' :
    audit.canReplaceCsv.verdict === 'partial' ? 'warning' :
    audit.canReplaceCsv.verdict === 'no' ? 'danger' : 'info';

  const crosswalkTone =
    crosswalk.csv_vs_api_verdict === 'yes' ? 'success' :
    crosswalk.csv_vs_api_verdict === 'partial' ? 'warning' :
    crosswalk.csv_vs_api_verdict === 'no' ? 'danger' : 'info';
  const dupTone =
    crosswalk.duplication_risk === 'low' ? 'success' :
    crosswalk.duplication_risk === 'medium' ? 'warning' :
    crosswalk.duplication_risk === 'high' ? 'danger' : 'info';

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue/impact-audit">
      <SectionHeader
        eyebrow="Revenue · Diagnostic"
        title="Impact API audit"
        description={
          <>
            Read-only probe of the Impact Media Partner API using the
            credentials in server env. No ledger writes. No tokens
            leave the function. Ran at <code>{audit.ran_at}</code>.
          </>
        }
      />

      <Panel title="Authentication" eyebrow="Credential + reachability">
        {audit.auth_result === 'ok' ? (
          <Notice tone="success"><strong>Valid.</strong> {audit.auth_evidence}</Notice>
        ) : audit.auth_result === 'missing_env' ? (
          <Notice tone="danger"><strong>Not configured.</strong> {audit.auth_evidence}</Notice>
        ) : audit.auth_result === 'rejected' ? (
          <Notice tone="danger"><strong>Rejected.</strong> {audit.auth_evidence}</Notice>
        ) : audit.auth_result === 'network_error' ? (
          <Notice tone="warning"><strong>Network error.</strong> {audit.auth_evidence}</Notice>
        ) : (
          <Notice tone="warning"><strong>Unknown.</strong> {audit.auth_evidence}</Notice>
        )}
        <ul style={{ fontSize: 13, lineHeight: 1.7, margin: '10px 0 0', paddingLeft: 20 }}>
          <li>Credential vars present in env: <code>{audit.auth_configured ? 'yes' : 'no'}</code></li>
          <li>Account SID present: <code>{audit.account_sid_present ? 'yes' : 'no'}</code></li>
          <li>Auth method: <code>HTTP Basic (base64(SID:token))</code></li>
          <li>Base URL: <code>https://api.impact.com/Mediapartners/&lt;SID&gt;</code></li>
          <li>Actions / ActionUpdates window: <strong>30 days</strong> (Impact caps Actions at 45; 30 keeps a safety margin).</li>
          <li>ClickExport window: <strong>7 days</strong>.</li>
          <li>400 and endpoint-specific 403 are <strong>not</strong> credential rejection — see per-endpoint status below.</li>
        </ul>
      </Panel>

      <Panel title="Can this replace our EPN CSV workflow? (shape test)" eyebrow="Verdict based on live field presence">
        <Notice tone={verdictTone}>
          <strong style={{ textTransform: 'uppercase' }}>{audit.canReplaceCsv.verdict}</strong>
        </Notice>
        <ul style={{ fontSize: 13, lineHeight: 1.7, margin: '10px 0 0', paddingLeft: 20 }}>
          {audit.canReplaceCsv.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </Panel>

      <Panel title="API ↔ CSV crosswalk (identity + duplication)" eyebrow="Does the API map to our existing EPN ledger?">
        <div style={{ display: 'grid', gap: 10 }}>
          <Notice tone={crosswalkTone}>
            <strong style={{ textTransform: 'uppercase' }}>Verdict: {crosswalk.csv_vs_api_verdict}</strong>
          </Notice>
          <Notice tone={dupTone}>
            <strong>Duplication risk: {crosswalk.duplication_risk.toUpperCase()}</strong>
            {' '}· canonical identity: <code>{crosswalk.canonical_identity}</code>
          </Notice>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}><strong>Canonical evidence:</strong> {crosswalk.canonical_evidence}</div>
          <ul style={{ fontSize: 13, lineHeight: 1.6, margin: 0, paddingLeft: 20 }}>
            {crosswalk.csv_vs_api_reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          {crosswalk.skipped_reason && (
            <Notice tone="warning"><strong>Not run:</strong> {crosswalk.skipped_reason}</Notice>
          )}
          {crosswalk.warnings.length > 0 && (
            <ul style={{ fontSize: 12.5, lineHeight: 1.6, margin: 0, paddingLeft: 20, color: 'var(--admin-text-muted)' }}>
              {crosswalk.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 10 }}>
            <KV label="Window" value={`${crosswalk.actions_window_days}d`} />
            <KV
              label="Actions total in window"
              value={crosswalk.actions_total_in_window != null
                ? crosswalk.actions_total_in_window.toLocaleString()
                : '(envelope absent)'}
            />
            <KV label="Actions examined" value={crosswalk.actions_examined.toLocaleString()} />
            <KV
              label="Pages fetched"
              value={`${crosswalk.actions_pages_fetched} × ${crosswalk.actions_page_size.toLocaleString()}`}
            />
            <KV
              label="Safety cap"
              value={crosswalk.safety_cap_hit
                ? `HIT at ${crosswalk.safety_cap.toLocaleString()}`
                : `${crosswalk.safety_cap.toLocaleString()} (not hit)`}
              warn={crosswalk.safety_cap_hit}
            />
            <KV label="CSV rows in same window" value={crosswalk.csv_rows_in_same_window.toLocaleString()} />
            <KV
              label="Overall match rate"
              value={crosswalk.actions_examined > 0
                ? `${(crosswalk.overall_match_rate * 100).toFixed(1)}%`
                : '—'}
            />
            <KV label="Matched by Id ↔ external_ref" value={crosswalk.match_counts.by_external_ref_eq_id.toLocaleString()} />
            <KV label="Matched by Oid" value={crosswalk.match_counts.by_external_ref_eq_oid.toLocaleString()} />
            <KV label="Matched by OrderId" value={crosswalk.match_counts.by_external_ref_eq_order_id.toLocaleString()} />
            <KV label="Matched by date+amount" value={crosswalk.match_counts.by_date_amount_currency.toLocaleString()} />
            <KV label="Ambiguous composite" value={crosswalk.match_counts.ambiguous_date_amount.toLocaleString()} warn={crosswalk.match_counts.ambiguous_date_amount > 0} />
            <KV label="Unmatched" value={crosswalk.match_counts.unmatched.toLocaleString()} warn={crosswalk.match_counts.unmatched > 0} />
          </div>

          {crosswalk.example_matches.length > 0 && (
            <>
              <h3 className="admin-eyebrow" style={{ marginTop: 10, marginBottom: 6 }}>Sample match pairs (first 10, redacted)</h3>
              <Table
                columns={[
                  { key: 'id',  header: 'Action.Id',  render: (r) => <code style={{ fontSize: 11 }}>{r.action.action_id ?? '—'}</code> },
                  { key: 'oid', header: 'Oid',        render: (r) => <code style={{ fontSize: 11 }}>{r.action.oid ?? '—'}</code> },
                  { key: 'ord', header: 'OrderId',    render: (r) => <code style={{ fontSize: 11 }}>{r.action.order_id ?? '—'}</code> },
                  { key: 'st',  header: 'State',      render: (r) => <code>{r.action.state ?? '—'}</code> },
                  { key: 'dt',  header: 'Date',       render: (r) => r.action.action_date ?? '—' },
                  { key: 'cur', header: 'Ccy',        render: (r) => r.action.currency ?? '—' },
                  { key: 'pay', header: 'Payout (minor)', className: 'col-num', render: (r) => r.action.payout_minor ?? '—' },
                  { key: 'mb',  header: 'Match by',   render: (r) => r.match_by ? <StatusBadge state="success" label={r.match_by} /> : r.ambiguous ? <StatusBadge state="warning" label="ambiguous" /> : <span className="col-dim">—</span> },
                  { key: 'mref',header: 'CSV external_ref', render: (r) => r.matched_external_ref ? <code style={{ fontSize: 11 }}>{r.matched_external_ref}</code> : <span className="col-dim">—</span> },
                  { key: 'mst', header: 'CSV status', render: (r) => r.matched_ledger_status ?? <span className="col-dim">—</span> },
                ]}
                rows={crosswalk.example_matches.map((m, i) => ({ ...m, id: `m-${i}` }))}
                empty="No sample pairs."
              />
            </>
          )}
        </div>
      </Panel>

      <Panel title="Reversal + payout semantics (live sample)" eyebrow="Ledger rule to apply when ingesting">
        <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>
          <strong>Verdict: </strong><code>{crosswalk.reversal_semantics.verdict}</code>
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: '0 0 10px' }}>{crosswalk.reversal_semantics.evidence}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <KV label="REVERSED w/ positive payout" value={String(crosswalk.reversal_semantics.reversed_payout_signs.positive)} />
          <KV label="REVERSED w/ zero payout" value={String(crosswalk.reversal_semantics.reversed_payout_signs.zero)} />
          <KV label="REVERSED w/ negative payout" value={String(crosswalk.reversal_semantics.reversed_payout_signs.negative)} />
        </div>
        <h3 className="admin-eyebrow" style={{ marginTop: 10, marginBottom: 6 }}>All states sampled</h3>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
          {Object.entries(crosswalk.reversal_semantics.states_sampled).map(([s, n]) => (
            <li key={s}><code>{s}</code> — {n}</li>
          ))}
          {Object.keys(crosswalk.reversal_semantics.states_sampled).length === 0 && (
            <li className="col-dim">(no states observed)</li>
          )}
        </ul>
      </Panel>

      {audit.warnings.length > 0 && (
        <Panel title={`Warnings (${audit.warnings.length})`} eyebrow="Observations">
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
            {audit.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Panel>
      )}

      <Panel title="Campaigns" eyebrow="Advertiser programs on this account">
        <Table
          columns={[
            { key: 'cid',  header: 'Campaign ID',    render: (r) => <code>{r.campaignId}</code> },
            { key: 'name', header: 'Campaign name',  render: (r) => r.campaignName ?? <span className="col-dim">—</span> },
            { key: 'adv',  header: 'Advertiser',     render: (r) => r.advertiserName ?? <span className="col-dim">—</span> },
          ]}
          rows={audit.attribution.distinctCampaigns.map((c) => ({ ...c, id: c.campaignId || c.campaignName || Math.random().toString() }))}
          empty="No campaigns returned."
        />
      </Panel>

      {Object.entries(audit.endpoints).map(([key, ep]) => (
        <EndpointPanel key={key} name={key} ep={ep} />
      ))}

      <Panel title="Attribution signals" eyebrow="SubId / SharedId / URL population">
        <p className="col-dim" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
          Across the {audit.attribution.totalSampleRows} sampled rows (Actions + Clicks when available), how often each
          attribution field is populated. SubId1 is our best candidate for site attribution if outbound links are
          configured to carry the Collector Network site slug.
        </p>
        <Table
          columns={[
            { key: 'field', header: 'Field', render: (r) => <code>{r.field}</code> },
            { key: 'populated', header: 'Rows populated', className: 'col-num', render: (r) => r.populated.toLocaleString() },
            { key: 'pct', header: 'Coverage', className: 'col-num', render: (r) => audit.attribution.totalSampleRows > 0 ? `${((r.populated / audit.attribution.totalSampleRows) * 100).toFixed(0)}%` : '—' },
          ]}
          rows={[
            { id: 1, field: 'SubId1', populated: audit.attribution.withSubId1 },
            { id: 2, field: 'SubId2', populated: audit.attribution.withSubId2 },
            { id: 3, field: 'SubId3', populated: audit.attribution.withSubId3 },
            { id: 4, field: 'SubId4', populated: audit.attribution.withSubId4 },
            { id: 5, field: 'SharedId', populated: audit.attribution.withSharedId },
            { id: 6, field: 'ReferringUrl', populated: audit.attribution.withReferringUrl },
            { id: 7, field: 'LandingPageUrl', populated: audit.attribution.withLandingPageUrl },
          ]}
          empty="No sampled rows."
        />
        {audit.attribution.distinctSubId1Values.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5 }}>
            <strong>Distinct SubId1 values seen:</strong>{' '}
            {audit.attribution.distinctSubId1Values.map((v) => <code key={v} style={{ marginRight: 6 }}>{v}</code>)}
          </div>
        )}
      </Panel>

      <Panel title="Status + payout semantics" eyebrow="What Impact is actually returning">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <div>
            <h3 className="admin-eyebrow" style={{ marginBottom: 6 }}>Action states</h3>
            {audit.statuses.distinctActionStates.length === 0 ? (
              <span className="col-dim" style={{ fontSize: 12.5 }}>No state values seen in sampled actions.</span>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                {audit.statuses.distinctActionStates.map((s) => (
                  <li key={s.value}><code>{s.value}</code> — {s.count}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="admin-eyebrow" style={{ marginBottom: 6 }}>Action-update states</h3>
            {audit.statuses.distinctActionUpdateStates.length === 0 ? (
              <span className="col-dim" style={{ fontSize: 12.5 }}>No state values seen in sampled updates.</span>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                {audit.statuses.distinctActionUpdateStates.map((s) => (
                  <li key={s.value}><code>{s.value}</code> — {s.count}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="admin-eyebrow" style={{ marginBottom: 6 }}>Currencies</h3>
            {audit.statuses.currenciesSeen.length === 0 ? (
              <span className="col-dim" style={{ fontSize: 12.5 }}>None seen.</span>
            ) : (
              audit.statuses.currenciesSeen.map((c) => <code key={c} style={{ marginRight: 6 }}>{c}</code>)
            )}
          </div>
          <div>
            <h3 className="admin-eyebrow" style={{ marginBottom: 6 }}>Payout presence</h3>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
              <li>With positive payout: {audit.statuses.payoutValuePresence.withPayout}</li>
              <li>With zero payout: {audit.statuses.payoutValuePresence.withZeroPayout}</li>
              <li>With null/empty payout: {audit.statuses.payoutValuePresence.withNullPayout}</li>
            </ul>
          </div>
        </div>
      </Panel>

      <Panel title="EPN CSV ↔ Impact API field map" eyebrow="Documented mapping (confirm against the live field samples above)">
        <Table
          columns={[
            { key: 'csv', header: 'CSV column', render: (r) => <strong>{r.csvColumn}</strong> },
            { key: 'api', header: 'API field', render: (r) => r.apiField ? <code>{r.apiField}</code> : <span className="col-dim">—</span> },
            { key: 'ep',  header: 'Endpoint', render: (r) => <code>{r.endpoint}</code> },
            { key: 'notes', header: 'Notes', render: (r) => <span style={{ fontSize: 12.5 }}>{r.notes}</span> },
          ]}
          rows={audit.csvComparison.map((r, i) => ({ ...r, id: i }))}
          empty=""
        />
      </Panel>

      <Panel title="Historical backfill plan (DESIGN ONLY — not executed)" eyebrow="How we would ingest a year">
        <ul style={{ fontSize: 13, lineHeight: 1.7, margin: '0 0 10px', paddingLeft: 20 }}>
          <li>Total days: <strong>{audit.backfillPlan.totalDays}</strong></li>
          <li>Window size: <strong>{audit.backfillPlan.windowDays}</strong> days (safely under Impact's 45-day Actions cap)</li>
          <li>Window count: <strong>{audit.backfillPlan.windowCount}</strong> (newest-first)</li>
          <li>API-call estimate: <strong>{audit.backfillPlan.estimatedApiCalls.totalMin}–{audit.backfillPlan.estimatedApiCalls.totalMax}</strong> total requests</li>
        </ul>
        <ul style={{ fontSize: 12.5, lineHeight: 1.65, margin: '0 0 12px', paddingLeft: 20, color: 'var(--admin-text-muted)' }}>
          <li>/Actions: {audit.backfillPlan.estimatedApiCalls.actions}</li>
          <li>/ActionUpdates: {audit.backfillPlan.estimatedApiCalls.actionUpdates}</li>
          <li>/ClickExport: {audit.backfillPlan.estimatedApiCalls.clickExport}</li>
          <li>/Campaigns: {audit.backfillPlan.estimatedApiCalls.campaigns}</li>
          <li>/Invoices: {audit.backfillPlan.estimatedApiCalls.invoices}</li>
        </ul>
        <h3 className="admin-eyebrow" style={{ marginBottom: 6 }}>Planned windows</h3>
        <ol style={{ fontSize: 12.5, columns: 2, margin: '0 0 12px', paddingLeft: 20 }}>
          {audit.backfillPlan.windows.map((w, i) => (
            <li key={i}><code>{w.start} → {w.end}</code></li>
          ))}
        </ol>
        <h3 className="admin-eyebrow" style={{ marginBottom: 6 }}>Notes</h3>
        <ul style={{ fontSize: 13, lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
          {audit.backfillPlan.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      </Panel>
    </AdminShell>
  );
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

function EndpointPanel({ name, ep }: { name: string; ep: EndpointAudit }) {
  const label = name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  const statusTone =
    ep.ok ? 'success' :
    ep.status === 401 ? 'failed' :
    ep.status === 403 ? 'warning' :
    ep.status === 400 ? 'warning' :
    ep.status === 404 ? 'info' :
    'info';
  return (
    <Panel
      title={`${label} — ${ep.endpoint}`}
      eyebrow={ep.description}
      actions={
        <StatusBadge
          state={statusTone}
          label={`${ep.status} ${ep.ok ? 'OK' : (ep.errorMessage ?? 'error')}`}
        />
      }
    >
      {Object.keys(ep.queryUsed).length > 0 && (
        <p className="col-dim" style={{ fontSize: 12, margin: '0 0 8px' }}>
          <strong>Query:</strong>{' '}
          {Object.entries(ep.queryUsed).map(([k, v]) => (
            <span key={k} style={{ marginRight: 10 }}><code>{k}={v}</code></span>
          ))}
        </p>
      )}
      {ep.contentType && (
        <p className="col-dim" style={{ fontSize: 12, margin: '0 0 8px' }}>
          <strong>Content-Type:</strong> <code>{ep.contentType}</code>
          {ep.bodyBytes > 0 && <> · {ep.bodyBytes.toLocaleString()} bytes</>}
        </p>
      )}
      {!ep.ok && (
        <div style={{ fontSize: 12.5, margin: '0 0 10px' }}>
          <div className="col-dim" style={{ marginBottom: 4 }}>Response excerpt:</div>
          <pre style={{ background: 'var(--admin-surface-strong)', padding: 8, borderRadius: 6, maxHeight: 160, overflow: 'auto', fontSize: 11, fontFamily: 'var(--admin-font-mono)' }}>
            {ep.rawExcerpt || '(empty)'}
          </pre>
        </div>
      )}
      {ep.ok && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10, fontSize: 12.5 }}>
            <span><strong>Records in sample:</strong> {ep.recordCount ?? '?'}</span>
            <span><strong>Top-level keys:</strong> {ep.topLevelKeys.join(', ') || '—'}</span>
            <span><strong>Record keys:</strong> {ep.recordKeys.length}</span>
          </div>
          {ep.sampleFields.length > 0 ? (
            <Table
              columns={[
                { key: 'f', header: 'Field', render: (r) => <code>{r.key}</code> },
                { key: 't', header: 'Type', render: (r) => <code style={{ fontSize: 11 }}>{r.typeHint}</code> },
                { key: 'e', header: 'Example value', render: (r) => r.isLikelySecret
                  ? <span style={{ color: 'var(--warning)' }}>[redacted]</span>
                  : r.exampleValue == null
                    ? <span className="col-dim">—</span>
                    : <code style={{ fontSize: 11 }}>{r.exampleValue}</code> },
              ]}
              rows={ep.sampleFields.map((f) => ({ ...f, id: f.key }))}
              empty=""
            />
          ) : (
            ep.contentType?.includes('text/csv') ? (
              <>
                <p className="col-dim" style={{ fontSize: 12.5, margin: '0 0 6px' }}>CSV body excerpt (first 2 KB):</p>
                <pre style={{ background: 'var(--admin-surface-strong)', padding: 8, borderRadius: 6, maxHeight: 220, overflow: 'auto', fontSize: 11, fontFamily: 'var(--admin-font-mono)' }}>
                  {ep.rawExcerpt || '(empty)'}
                </pre>
              </>
            ) : (
              <span className="col-dim" style={{ fontSize: 12.5 }}>Response was 2xx but no record array was found at known keys. Raw body:</span>
            )
          )}
        </>
      )}
    </Panel>
  );
}
