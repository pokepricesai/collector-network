import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listOpenOpportunities } from '@/server/revenue/opportunities';
import { scanOpportunitiesAction, promoteOpportunityToTaskAction, dismissOpportunityAction } from '@/server/revenue/opportunity-actions';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function OpportunitiesPage() {
  const { admin, sb } = await requireAdmin('/admin/revenue/opportunities');
  const sites = await listNetworkSites(sb);
  const opps = await listOpenOpportunities(sb, 100);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/revenue/opportunities">
      <SectionHeader
        eyebrow="Revenue"
        title="Commercial opportunities"
        description="Deterministic signals derived from current OS state. The engine never contacts anyone. Promoting a finding into a task is an explicit human action."
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <form action={scanOpportunitiesAction}><button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '6px 12px' }}>Run scan</button></form>
            <Link className="status-badge status-not_connected" href="/admin/revenue">← Dashboard</Link>
          </span>
        }
      />
      <Panel title={`Open opportunities (${opps.length})`} eyebrow="Deterministic engine">
        <Table
          rows={opps}
          columns={[
            { key: 'sev', header: 'Severity', render: (o) => <StatusBadge state={o.severity === 'critical' ? 'critical' : o.severity === 'high' ? 'high' : 'info'} label={o.severity} /> },
            { key: 'kind', header: 'Kind', render: (o) => <code style={{ fontSize: 11 }}>{o.kind.replace(/_/g, ' ')}</code> },
            { key: 'title', header: 'Finding', render: (o) => (
              <span>
                <strong>{o.title}</strong>
                <div className="col-dim" style={{ fontSize: 12 }}>{o.rationale}</div>
              </span>
            ) },
            { key: 'when', header: 'Found', render: (o) => <span className="col-dim" style={{ fontSize: 11 }}>{formatRelative(o.created_at)}</span> },
            { key: 'actions', header: 'Actions', render: (o) => (
              <span style={{ display: 'inline-flex', gap: 6 }}>
                <form action={promoteOpportunityToTaskAction}><input type="hidden" name="id" value={o.id} /><button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 11, padding: '4px 10px' }}>→ Task</button></form>
                <form action={dismissOpportunityAction}><input type="hidden" name="id" value={o.id} /><button type="submit" className="status-badge status-dismissed" style={{ cursor: 'pointer', border: 'none', fontSize: 11, padding: '4px 10px' }}>Dismiss</button></form>
                {o.partner_id && <Link className="status-badge status-info" href={`/admin/partners/${o.partner_id}`} style={{ fontSize: 11, padding: '4px 10px' }}>Partner</Link>}
                {o.sponsorship_id && <Link className="status-badge status-info" href={`/admin/partners/sponsorships/${o.sponsorship_id}`} style={{ fontSize: 11, padding: '4px 10px' }}>Deal</Link>}
              </span>
            ) },
          ]}
          empty={<span className="col-dim">No open opportunities. Click "Run scan" to detect new ones from current state.</span>}
        />
      </Panel>
      <Panel title="How this engine works" eyebrow="Transparency">
        <ul style={{ fontSize: 12, lineHeight: 1.6 }}>
          <li><strong>sponsor_renewal_due</strong> — active sponsorship whose renewal_reminder_on ≤ today.</li>
          <li><strong>underperforming_source</strong> — revenue source zero or down &gt; 60% vs prior 28d.</li>
          <li><strong>affiliate_optimisation</strong> — site has ≥ 100 clicks in 28d but 0 reconciled conversions.</li>
          <li><strong>revenue_gap_vs_traffic</strong> — site has ≥ 10k sessions (GA4) in 28d but &lt; £10 GBP revenue.</li>
          <li><strong>offer_gap</strong> — active/accepted sponsorship with zero deliverables.</li>
        </ul>
      </Panel>
    </AdminShell>
  );
}
