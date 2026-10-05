import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table, EmptyState } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { previewEpnImportAction, commitEpnImportAction, cancelEpnPreviewAction, readPreviewForUi, readCampaignMapAudit } from '@/server/revenue/epn-import-actions';
import { formatInt, formatMoneyMinor } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

interface Params { searchParams: Promise<{ step?: string }> }

export default async function RevenueImportPage({ searchParams }: Params) {
  const { admin, sb } = await requireAdmin('/admin/revenue/import');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const [preview, campaignAudit] = await Promise.all([
    sp.step === 'preview' ? readPreviewForUi() : Promise.resolve(null),
    readCampaignMapAudit(),
  ]);
  const inp: React.CSSProperties = { padding: '6px 8px', border: '1px solid #D4D4D4', borderRadius: 4, fontSize: 13, fontFamily: 'inherit' };
  const resolvedCount = campaignAudit.parsed_rows.filter((r) => r.resolved).length;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue/import">
      <SectionHeader
        eyebrow="Revenue"
        title="Import affiliate CSV"
        description="Upload an eBay Partner Network transactions export. We parse, preview and require explicit confirmation before any DB write. Already-known transactions are reconciled: status changes (pending → confirmed, pending → reversed) and amount corrections are detected and recorded in the status history."
        actions={<Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/revenue">← Dashboard</Link>}
      />

      <Panel title="Integrations" eyebrow="Status">
        <ul style={{ fontSize: 13, lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
          <li><strong>eBay Partner Network</strong> — CSV import live (see below).{' '}
            {!campaignAudit.raw_present ? (
              <StatusBadge state="warning" label="EPN_CAMPAIGN_MAP env not set" />
            ) : resolvedCount > 0 && campaignAudit.invalid_rows.length === 0 && campaignAudit.parsed_rows.every((r) => r.resolved) ? (
              <StatusBadge state="success" label={`campaign map configured · ${resolvedCount} campaign(s)`} />
            ) : (
              <StatusBadge state="warning" label={`campaign map has issues · ${resolvedCount} resolved / ${campaignAudit.parsed_rows.length + campaignAudit.invalid_rows.length} entries`} />
            )}
          </li>
          <li><strong>Impact.com (TCGplayer)</strong> — <StatusBadge state="info" label="awaiting first report import" /> · parser not yet shipped; add once Luke provides a real CSV sample.</li>
          <li><strong>Whatnot</strong> — <StatusBadge state="not_connected" label="not connected" /> · no credentials / report format available.</li>
        </ul>
      </Panel>

      {campaignAudit.raw_present && (
        <Panel title={`Parsed EPN_CAMPAIGN_MAP (${campaignAudit.parsed_rows.length} entries)`} eyebrow="What the hub reads">
          {campaignAudit.parsed_rows.length === 0 ? (
            <span className="col-dim" style={{ fontSize: 12 }}>Env var present ({campaignAudit.raw_length} chars) but produced zero rows. See invalid-rows list below.</span>
          ) : (
            <table className="admin-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Campaign ID</th>
                  <th>Site slug</th>
                  <th>Source slug</th>
                  <th>Currency</th>
                  <th>Resolved?</th>
                </tr>
              </thead>
              <tbody>
                {campaignAudit.parsed_rows.map((r) => (
                  <tr key={`${r.campaign_id}-${r.site_slug}-${r.source_slug}`}>
                    <td><code>{r.campaign_id}</code></td>
                    <td>{r.site_slug}</td>
                    <td><code style={{ fontSize: 11 }}>{r.source_slug}</code></td>
                    <td><code>{r.currency}</code></td>
                    <td>
                      {r.resolved
                        ? <StatusBadge state="success" label="resolved" />
                        : <StatusBadge state="warning" label={r.issue ?? 'unresolved'} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {campaignAudit.invalid_rows.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <strong style={{ fontSize: 12 }}>Invalid entries:</strong>
              <ul style={{ fontSize: 12, margin: '6px 0 0', paddingLeft: 20 }}>
                {campaignAudit.invalid_rows.map((r, i) => <li key={i}><code>{r.raw_part}</code> — {r.reason}</li>)}
              </ul>
            </div>
          )}
          <p className="col-dim" style={{ fontSize: 11, marginTop: 10 }}>
            Campaign IDs are public (they ride on every outbound eBay link). Only entries where <em>Resolved</em> = yes will attribute an import to a site.
          </p>
        </Panel>
      )}

      {!preview && (
        <Panel title="Export a fresh CSV from eBay EPN first" eyebrow="Important for reconciliation">
          <ul style={{ fontSize: 13, lineHeight: 1.75, margin: 0, paddingLeft: 20 }}>
            <li>Open the eBay Partner Network <strong>Transactions</strong> report and export <strong>right now</strong>. An old static CSV from a previous month can only prove dedupe — it cannot discover status changes (pending → confirmed, pending → reversed) that happened after it was downloaded.</li>
            <li>Set the date range to <strong>the earliest EPN activity you want reconciled → today</strong>. For a full-year refresh, pick a <strong>365-day</strong> window ending today.</li>
            <li>Keep <strong>all statuses included</strong> (confirmed + pending + reversed). Filtering out pending/reversed hides exactly the transitions this flow needs to see.</li>
            <li>Up to <strong>~50,000 rows per file</strong> is comfortable. Beyond that, split by quarter and upload sequentially — each run is idempotent so chunk order doesn&apos;t matter.</li>
            <li>Prefer <strong>one file</strong> if it fits — fewer uploads, one Reconciliation Preview to inspect, one history row per actual transition.</li>
          </ul>
          <p className="col-dim" style={{ fontSize: 12, marginTop: 10 }}>
            <strong>What you should expect on the Reconciliation Preview:</strong> a large <em>Unchanged</em> count equal to most of the file (previously-known transactions that haven&apos;t moved), a <em>New</em> count for transactions eBay has booked since your last import, and non-zero <em>Status transitions</em> + <em>Amount corrections</em> if any pending rows have cleared, reversed, or been re-stated.
          </p>
        </Panel>
      )}

      {!preview && (
        <Panel title="Step 1: Upload" eyebrow="EPN CSV">
          <form action={previewEpnImportAction} encType="multipart/form-data" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 820 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>eBay EPN transactions CSV</span>
              <input type="file" name="file" accept=".csv,text/csv" required style={inp} />
            </label>
            <p className="col-dim" style={{ fontSize: 12, margin: 0 }}>
              Max 10MB. Supported columns include <code>Event Date</code>, <code>Earnings</code>, <code>Campaign ID</code>, <code>Custom ID</code>, <code>Order ID</code>, <code>Status</code>, <code>Currency</code>, <code>Item Title</code>. Unknown columns are ignored.
            </p>
            <div>
              <button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 13, padding: '8px 14px' }}>Preview</button>
            </div>
          </form>
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12 }}>Configuring campaign → site attribution</summary>
            <pre style={{ fontSize: 11, background: '#FAFAFA', padding: 10, borderRadius: 4, marginTop: 8 }}>{`EPN_CAMPAIGN_MAP="<campaignId>:<siteSlug>:<revenueSourceSlug>:<currency>,..."

Site slugs:   pokemon, mtg, ygo, onepiece, lorcana
Source slugs: ebay_epn_uk, ebay_epn_us (seeded)
Example:      5338606910:pokemon:ebay_epn_uk:GBP,5339215010:lorcana:ebay_epn_uk:GBP`}</pre>
          </details>
        </Panel>
      )}

      {preview && (
        <>
          <Panel title={`Step 2: Preview — ${preview.file_name}`} eyebrow="Nothing written yet">
            <div className="metric-grid metric-grid--compact">
              {Object.entries(preview.totals_by_currency).map(([ccy, t]) => (
                <div key={ccy} className="metric-card">
                  <div className="metric-label">Net {ccy}</div>
                  <div className="metric-value metric-value--ok">{formatMoneyMinor(t.net_minor, ccy)}</div>
                  <div className="metric-helper">pending {formatMoneyMinor(t.pending_minor, ccy)} · reversed {formatMoneyMinor(t.reversed_minor, ccy)} · {t.row_count} rows</div>
                </div>
              ))}
              <div className="metric-card">
                <div className="metric-label">Date range</div>
                <div className="metric-value metric-value--ok" style={{ fontSize: 15 }}>{preview.date_min ?? '—'} → {preview.date_max ?? '—'}</div>
                <div className="metric-helper">{preview.total_rows} rows parsed · {preview.accepted.length} accepted · {preview.rejected.length} rejected</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Duplicates in file</div>
                <div className={`metric-value ${preview.duplicate_transaction_ids.length ? 'metric-value--not-connected' : 'metric-value--ok'}`}>{preview.duplicate_transaction_ids.length}</div>
                <div className="metric-helper">dedupe by transaction id — safe to re-import</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Unmapped campaigns</div>
                <div className={`metric-value ${preview.unmapped_campaigns.length ? 'metric-value--not-connected' : 'metric-value--ok'}`}>{preview.unmapped_campaigns.length}</div>
                <div className="metric-helper">rows import without site attribution</div>
              </div>
            </div>
            {preview.unmapped_campaigns.length > 0 && (
              <p className="col-dim" style={{ fontSize: 12, marginTop: 10 }}>
                Unmapped campaign IDs: <code>{preview.unmapped_campaigns.join(', ')}</code> — these rows will be skipped. Set <code>EPN_CAMPAIGN_MAP</code> on the hub Vercel project to attribute them.
              </p>
            )}
          </Panel>

          {preview.reconciliation && (
            <Panel title="Reconciliation plan" eyebrow="What will change in the database">
              <div className="metric-grid metric-grid--compact" style={{ marginBottom: 12 }}>
                <div className="metric-card">
                  <div className="metric-label">New transactions</div>
                  <div className="metric-value metric-value--ok">{preview.reconciliation.new_count}</div>
                  <div className="metric-helper">will be inserted</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Unchanged</div>
                  <div className="metric-value metric-value--muted">{preview.reconciliation.unchanged_count}</div>
                  <div className="metric-helper">no DB write</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Status transitions</div>
                  <div className={`metric-value ${preview.reconciliation.status_transitions.length ? 'metric-value--ok' : 'metric-value--muted'}`}>{preview.reconciliation.status_transitions.length}</div>
                  <div className="metric-helper">pending → confirmed / reversed etc.</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Amount corrections</div>
                  <div className={`metric-value ${preview.reconciliation.amount_corrections.length ? 'metric-value--ok' : 'metric-value--muted'}`}>{preview.reconciliation.amount_corrections.length}</div>
                  <div className="metric-helper">commission re-stated by eBay</div>
                </div>
              </div>

              {preview.reconciliation.status_transitions.length > 0 && (() => {
                const bucket: Record<string, number> = {};
                for (const t of preview.reconciliation.status_transitions) {
                  const k = `${t.from_status ?? 'unknown'} → ${t.to_status}`;
                  bucket[k] = (bucket[k] ?? 0) + 1;
                }
                return (
                  <>
                    <p className="col-dim" style={{ fontSize: 12, margin: '0 0 6px' }}>Transition breakdown:</p>
                    <ul style={{ fontSize: 13, margin: 0, paddingLeft: 20 }}>
                      {Object.entries(bucket)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, n]) => <li key={k}><code>{k}</code> — {n} row{n === 1 ? '' : 's'}</li>)}
                    </ul>
                  </>
                );
              })()}

              {preview.reconciliation.amount_corrections.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <p className="col-dim" style={{ fontSize: 12, margin: '0 0 6px' }}>First 10 amount corrections:</p>
                  <ul style={{ fontSize: 12.5, margin: 0, paddingLeft: 20 }}>
                    {preview.reconciliation.amount_corrections.slice(0, 10).map((c, i) => (
                      <li key={i}>
                        <code>{c.transaction_id.slice(0, 20)}</code>:{' '}
                        {formatMoneyMinor(c.from_minor, c.currency)} → {formatMoneyMinor(c.to_minor, c.currency)} ({c.status})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.reconciliation.unmapped_campaigns.length > 0 && (
                <p className="col-dim" style={{ fontSize: 12, marginTop: 10 }}>
                  Unmapped campaigns in this file: <code>{preview.reconciliation.unmapped_campaigns.join(', ')}</code>
                </p>
              )}
            </Panel>
          )}

          <Panel title={`Accepted rows (${preview.accepted.length})`} eyebrow="First 25">
            <Table
              rows={preview.accepted.slice(0, 25).map((r) => ({ id: r.row_index, ...r }))}
              columns={[
                { key: 'date', header: 'Date', render: (r) => <code>{r.occurred_on}</code> },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge state={r.status === 'confirmed' ? 'success' : r.status === 'pending' ? 'info' : r.status === 'reversed' ? 'warning' : 'dismissed'} label={r.status} /> },
                { key: 'campaign', header: 'Campaign', render: (r) => <code style={{ fontSize: 11 }}>{r.campaign_id ?? '—'}</code> },
                { key: 'site', header: 'Site', render: (r) => r.mapped_site_slug ?? <span className="col-dim">unmapped</span> },
                { key: 'customid', header: 'Sub-id', render: (r) => <span style={{ fontSize: 12 }}>{r.custom_id ?? ''}</span> },
                { key: 'amount', header: 'Earnings', className: 'num', render: (r) => formatMoneyMinor(r.earnings_minor, r.currency) },
                { key: 'txid', header: 'Txn id', render: (r) => <code style={{ fontSize: 10 }}>{r.transaction_id.slice(0, 24)}</code> },
              ]}
            />
          </Panel>

          {preview.rejected.length > 0 && (
            <Panel title={`Rejected rows (${preview.rejected.length})`} eyebrow="Not imported">
              <ul style={{ fontSize: 12, margin: 0, paddingLeft: 20 }}>
                {preview.rejected.slice(0, 25).map((r) => (
                  <li key={r.row_index}><strong>Row {r.row_index}</strong>: {r.reason}</li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Step 3: Commit" eyebrow="Explicit confirmation">
            <p style={{ fontSize: 13 }}>
              This will insert {preview.reconciliation?.new_count ?? '?'} new transaction(s), update {preview.reconciliation?.status_transitions.length ?? '?'} status transition(s) and {preview.reconciliation?.amount_corrections.length ?? '?'} amount correction(s). Unchanged rows ({preview.reconciliation?.unchanged_count ?? '?'}) perform no DB write. Rows with unmapped campaigns are skipped. Every observation also appends to <code>network_affiliate_status_history</code>.
            </p>
            <div style={{ display: 'inline-flex', gap: 8 }}>
              <form action={commitEpnImportAction}>
                <button type="submit" className="ui-btn ui-btn--primary">Commit import</button>
              </form>
              <form action={cancelEpnPreviewAction}>
                <button type="submit" className="ui-btn ui-btn--secondary ui-btn--sm">Cancel preview</button>
              </form>
            </div>
          </Panel>
        </>
      )}

      {!preview && (
        <Panel title="How this works" eyebrow="Transparency">
          <ul style={{ fontSize: 13, lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
            <li>CSV parsed server-side; nothing is written until you click <strong>Commit import</strong>.</li>
            <li>Each row&apos;s EPN transaction id is the idempotency key. Re-uploading the same report is <strong>safe</strong>: unchanged rows are skipped and only genuine changes are applied.</li>
            <li>When a known transaction appears with a <strong>different status</strong> (e.g. pending → confirmed, pending → reversed) or a <strong>corrected amount</strong>, the row is updated and the transition is appended to <code>network_affiliate_status_history</code>.</li>
            <li>Reversed transactions are stored with <code>event_kind = &apos;reversal&apos;</code> and a negative amount so the ledger nets correctly without double-counting.</li>
            <li>Pending vs confirmed vs reversed is read from <code>ledger_status</code> on each row (indexable). The dashboard separates them by currency and never combines GBP + USD.</li>
          </ul>
        </Panel>
      )}
    </AdminShell>
  );
}
