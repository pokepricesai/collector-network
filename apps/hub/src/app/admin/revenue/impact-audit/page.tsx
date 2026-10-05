import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { runImpactAudit, type EndpointAudit } from '@/server/impact/audit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

// Read-only Impact API audit. Admin-only, server-side only. The
// Impact token and account SID stay in the function's env; neither
// leaves the server. Burns ~6 Impact API calls per load.

export default async function ImpactAuditPage() {
  const { admin, sb } = await requireAdmin('/admin/revenue/impact-audit');
  const sites = await listNetworkSites(sb);
  const audit = await runImpactAudit();

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
          <Notice tone="success"><strong>Authenticated</strong> — all probed endpoints returned 2xx.</Notice>
        ) : audit.auth_result === 'missing_env' ? (
          <Notice tone="danger"><strong>Not configured.</strong> IMPACT_ACCOUNT_SID or IMPACT_API_TOKEN is missing from this environment.</Notice>
        ) : audit.auth_result === 'rejected' ? (
          <Notice tone="danger"><strong>Authentication rejected.</strong> At least one endpoint returned 401/403. Verify the SID and token in Vercel.</Notice>
        ) : audit.auth_result === 'network_error' ? (
          <Notice tone="warning"><strong>Network error.</strong> One or more calls failed before reaching Impact.</Notice>
        ) : (
          <Notice tone="warning"><strong>Unknown.</strong> No endpoint returned 2xx or an auth error — see per-endpoint status below.</Notice>
        )}
        <ul style={{ fontSize: 13, lineHeight: 1.7, margin: '10px 0 0', paddingLeft: 20 }}>
          <li>Credential vars present in env: <code>{audit.auth_configured ? 'yes' : 'no'}</code></li>
          <li>Account SID present: <code>{audit.account_sid_present ? 'yes' : 'no'}</code></li>
          <li>Auth method: <code>HTTP Basic (base64(SID:token))</code></li>
          <li>Base URL: <code>https://api.impact.com/Mediapartners/&lt;SID&gt;</code></li>
          <li>Sample window: last 90 days (ActionDateStart → ActionDateEnd)</li>
        </ul>
      </Panel>

      {audit.warnings.length > 0 && (
        <Panel title={`Warnings (${audit.warnings.length})`} eyebrow="Found during audit">
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
            {audit.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Panel>
      )}

      {Object.entries(audit.endpoints).map(([key, ep]) => (
        <EndpointPanel key={key} name={key} ep={ep} />
      ))}

      <Panel title="Attribution signals" eyebrow="SubId / SharedId / URL population">
        <p className="col-dim" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
          Across the {audit.attribution.totalSampleRows} sampled rows (Actions + Clicks), how often each attribution
          field is populated. SubId1 is our best candidate for site attribution if outbound links are configured to carry
          the Collector Network site slug.
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

      <Panel title="Campaigns" eyebrow="Programs the account is enrolled in">
        <Table
          columns={[
            { key: 'id', header: 'ID', render: (r) => <code>{r.id}</code> },
            { key: 'name', header: 'Name', render: (r) => r.name ?? <span className="col-dim">—</span> },
          ]}
          rows={audit.attribution.distinctCampaigns.map((c, i) => ({ ...c, id: `camp-${i}` }))}
          empty="No campaign records returned."
        />
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
    </AdminShell>
  );
}

function EndpointPanel({ name, ep }: { name: string; ep: EndpointAudit }) {
  const label = name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  return (
    <Panel
      title={`${label} — ${ep.endpoint}`}
      eyebrow={ep.description}
      actions={
        <StatusBadge
          state={ep.ok ? 'success' : ep.status === 401 || ep.status === 403 ? 'failed' : ep.status === 404 ? 'warning' : 'info'}
          label={`${ep.status} ${ep.ok ? 'OK' : (ep.errorMessage ?? 'error')}`}
        />
      }
    >
      {!ep.ok && (
        <p className="col-dim" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
          Response excerpt:
          <pre style={{ background: 'var(--admin-surface-strong)', padding: 8, borderRadius: 6, maxHeight: 160, overflow: 'auto', fontSize: 11, fontFamily: 'var(--admin-font-mono)', marginTop: 4 }}>
            {ep.rawExcerpt || '(empty)'}
          </pre>
        </p>
      )}
      {ep.ok && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10, fontSize: 12.5 }}>
            <span><strong>Records in sample:</strong> {ep.recordCount ?? '?'}</span>
            <span><strong>Top-level keys:</strong> {ep.topLevelKeys.join(', ') || '—'}</span>
            <span><strong>Record keys:</strong> {ep.recordKeys.length}</span>
          </div>
          {ep.sampleFields.length > 0 && (
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
              rows={ep.sampleFields.map((f) => ({ id: f.key, ...f }))}
              empty="No sample record available."
            />
          )}
        </>
      )}
    </Panel>
  );
}
