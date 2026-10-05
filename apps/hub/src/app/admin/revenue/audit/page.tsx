import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { fetchLedgerAudit } from '@/server/revenue/audit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

// Read-only live audit of the EPN affiliate ledger. The OS itself
// inspects the production dataset instead of asking Luke to run SQL.

function fmtMinor(minor: number, ccy: string): string {
  const n = (minor ?? 0) / 100;
  const sym = ccy === 'GBP' ? '£' : ccy === 'USD' ? '$' : ccy === 'EUR' ? '€' : '';
  return `${sym}${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtMinorNoSym(minor: number): string {
  return ((minor ?? 0) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function RevenueAuditPage() {
  const { admin, sb } = await requireAdmin('/admin/revenue/audit');
  const sites = await listNetworkSites(sb);
  const audit = await fetchLedgerAudit(sb);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue/audit">
      <SectionHeader
        eyebrow="Revenue · Diagnostic"
        title="Affiliate ledger audit"
        description={
          <>
            Live read of <code>network_revenue_events</code> for EPN sources.
            Read-only, admin-only, counts {audit.total_rows.toLocaleString()} rows.
            Date range{' '}
            <strong>{audit.earliest_occurred ?? '—'}</strong> to{' '}
            <strong>{audit.latest_occurred ?? '—'}</strong>.
          </>
        }
      />

      <Panel title="Health" eyebrow="Data quality">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <KV label="Rows missing date" value={audit.rows_without_occurred_on.toLocaleString()} warn={audit.rows_without_occurred_on > 0} />
          <KV label="Rows missing amount" value={audit.rows_without_amount.toLocaleString()} warn={audit.rows_without_amount > 0} />
          <KV label="Rows missing currency" value={audit.rows_without_currency.toLocaleString()} warn={audit.rows_without_currency > 0} />
          <KV label="Rows missing status" value={audit.rows_without_ledger_status.toLocaleString()} warn={audit.rows_without_ledger_status > 0} />
          <KV label="History rows" value={audit.history_rows.toLocaleString()} />
          <KV label="Observed transitions" value={audit.history_transitions.toLocaleString()} />
        </div>
      </Panel>

      <Panel title="By currency" eyebrow="Totals">
        <Table
          columns={[
            { key: 'ccy', header: 'Currency', render: (r) => <strong>{r.currency}</strong> },
            { key: 'rows', header: 'Rows', className: 'col-num', render: (r) => r.rows.toLocaleString() },
            { key: 'booked', header: 'Confirmed', className: 'col-num', render: (r) => fmtMinor(r.booked, r.currency) },
            { key: 'pending', header: 'Pending', className: 'col-num', render: (r) => fmtMinor(r.pending, r.currency) },
            { key: 'reversed', header: 'Reversed', className: 'col-num', render: (r) => fmtMinor(r.reversed, r.currency) },
            { key: 'net', header: 'Net', className: 'col-num', render: (r) => fmtMinor(r.net, r.currency) },
          ]}
          rows={Object.entries(audit.by_currency).map(([ccy, b]) => ({
            id: ccy,
            currency: ccy,
            rows: b.rows,
            booked: b.booked_minor,
            pending: b.pending_minor,
            reversed: b.reversed_minor,
            net: b.net_minor,
          }))}
          empty="No EPN rows yet."
        />
      </Panel>

      <Panel title="By status" eyebrow="Raw status values">
        <Table
          columns={[
            { key: 'status', header: 'Status', render: (r) => <code>{r.status}</code> },
            { key: 'rows', header: 'Rows', className: 'col-num', render: (r) => r.rows.toLocaleString() },
            { key: 'amount', header: 'Amount (minor sum)', className: 'col-num', render: (r) => fmtMinorNoSym(r.amount) },
          ]}
          rows={audit.by_status.map((s, i) => ({ id: i, status: s.status, rows: s.rows, amount: s.amount_minor_total }))}
          empty="No status values recorded."
        />
      </Panel>

      <Panel title="By source" eyebrow="Attribution">
        <Table
          columns={[
            { key: 'slug', header: 'Source', render: (r) => <code>{r.slug}</code> },
            { key: 'name', header: 'Name', render: (r) => r.name },
            { key: 'rows', header: 'Rows', className: 'col-num', render: (r) => r.rows.toLocaleString() },
          ]}
          rows={audit.by_source.map((s, i) => ({ id: i, slug: s.source_slug, name: s.source_name, rows: s.rows }))}
          empty="No EPN sources."
        />
      </Panel>

      <Panel title="By campaign" eyebrow="Mapping coverage" actions={<a href="/admin/revenue/import" className="col-dim" style={{ fontSize: 12 }}>Edit campaign map</a>}>
        <Table
          columns={[
            { key: 'cid', header: 'Campaign ID', render: (r) => r.cid ? <code>{r.cid}</code> : <span className="col-dim">(none)</span> },
            { key: 'rows', header: 'Rows', className: 'col-num', render: (r) => r.rows.toLocaleString() },
            { key: 'mapped', header: 'Mapped', className: 'col-num', render: (r) => r.mapped.toLocaleString() },
            { key: 'unmapped', header: 'Unmapped', className: 'col-num', render: (r) => r.unmapped > 0 ? <strong style={{ color: 'var(--warning)' }}>{r.unmapped.toLocaleString()}</strong> : r.unmapped.toLocaleString() },
          ]}
          rows={audit.by_campaign.map((c, i) => ({ id: i, cid: c.campaign_id, rows: c.rows, mapped: c.mapped, unmapped: c.unmapped }))}
          empty="No campaign IDs present on EPN rows."
        />
      </Panel>

      <Panel title="Pending ageing" eyebrow="Current state">
        <p className="col-dim" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
          Ageing is based on <code>occurred_on</code> (the EPN event date) relative to today.
          Only rows whose <strong>current</strong> ledger_status is <code>pending</code> are counted.
        </p>
        <Table
          columns={[
            { key: 'bucket', header: 'Age', render: (r) => <strong>{r.bucket}</strong> },
            { key: 'rows', header: 'Rows', className: 'col-num', render: (r) => r.rows.toLocaleString() },
            { key: 'gbp', header: 'GBP', className: 'col-num', render: (r) => r.gbp != null ? fmtMinor(r.gbp, 'GBP') : <span className="col-dim">—</span> },
            { key: 'usd', header: 'USD', className: 'col-num', render: (r) => r.usd != null ? fmtMinor(r.usd, 'USD') : <span className="col-dim">—</span> },
          ]}
          rows={audit.aged_pending.map((b, i) => ({
            id: i,
            bucket: b.bucket,
            rows: b.rows,
            gbp: b.amount_minor_by_currency['GBP'] ?? null,
            usd: b.amount_minor_by_currency['USD'] ?? null,
          }))}
          empty="No pending rows."
        />
      </Panel>

      <Panel title="Duplicate transaction IDs" eyebrow="Should always be empty">
        {audit.duplicate_transaction_ids.length === 0 ? (
          <span className="col-dim" style={{ fontSize: 13 }}>No duplicate transaction IDs detected.</span>
        ) : (
          <Table
            columns={[
              { key: 'tx', header: 'Transaction ID', render: (r) => <code>{r.transaction_id}</code> },
              { key: 'count', header: 'Occurrences', className: 'col-num', render: (r) => r.count.toLocaleString() },
            ]}
            rows={audit.duplicate_transaction_ids.map((d, i) => ({ id: i, transaction_id: d.transaction_id, count: d.count }))}
            empty=""
          />
        )}
      </Panel>

      <Panel title="Recent imports" eyebrow="Audit log">
        <Table
          columns={[
            { key: 'when', header: 'Imported at', render: (r) => new Date(r.when).toISOString().slice(0, 16).replace('T', ' ') },
            { key: 'file', header: 'File', render: (r) => r.file ? <code>{r.file}</code> : <span className="col-dim">—</span> },
            { key: 'new', header: 'New', className: 'col-num', render: (r) => r.new.toLocaleString() },
            { key: 'upd', header: 'Updated', className: 'col-num', render: (r) => r.upd.toLocaleString() },
            { key: 'trans', header: 'Transitions', className: 'col-num', render: (r) => r.trans.toLocaleString() },
          ]}
          rows={audit.recent_imports.map((r, i) => ({
            id: i,
            when: r.occurred_at,
            file: r.file_name,
            new: r.new_rows,
            upd: r.updated_rows,
            trans: r.status_transitions,
          }))}
          empty="No imports logged yet."
        />
      </Panel>
    </AdminShell>
  );
}

function KV({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{
      border: '1px solid var(--admin-border)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      background: warn ? 'var(--warning-soft)' : 'var(--admin-surface)',
    }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-subtle)', fontWeight: 700, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: warn ? 'var(--warning)' : 'var(--admin-text)' }}>
        {value}
      </div>
    </div>
  );
}
