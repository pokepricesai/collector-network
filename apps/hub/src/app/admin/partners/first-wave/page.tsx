import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listCn06aPartners, listVendorCategories } from '@/server/partners/cn06a-queries';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function FirstWavePage() {
  const { admin, sb } = await requireAdmin('/admin/partners/first-wave');
  const sites = await listNetworkSites(sb);
  const [partners, categories] = await Promise.all([
    listCn06aPartners(sb, { firstWaveOnly: true }),
    listVendorCategories(sb),
  ]);
  const categoryLabel = (code: string | null) =>
    code ? (categories.find((c) => c.code === code)?.display_name ?? code) : '—';

  const avgFit = partners.filter((p) => p.fit_score != null).reduce((a, b) => a + (b.fit_score ?? 0), 0)
    / Math.max(1, partners.filter((p) => p.fit_score != null).length);

  // Contact signal for each wave partner — one query, enrich in-process.
  const partnerIds = partners.map((p) => p.id);
  type ContactSignal = { email: boolean; named: boolean; form: boolean };
  const signals = new Map<string, ContactSignal>();
  if (partnerIds.length > 0) {
    const { data: contactRows } = await sb.from('network_partner_contacts')
      .select('partner_id, email, email_verification, contact_url, full_name, suppressed')
      .in('partner_id', partnerIds);
    for (const c of contactRows ?? []) {
      if (c.suppressed) continue;
      const s = signals.get(c.partner_id) ?? { email: false, named: false, form: false };
      if (c.email && c.email_verification) s.email = true;
      if (c.full_name && !c.full_name.includes('—')) s.named = true;
      if (c.contact_url) s.form = true;
      signals.set(c.partner_id, s);
    }
  }
  // Also pull draft markers.
  const draftIds = new Set<string>();
  if (partnerIds.length > 0) {
    const { data: drafts } = await sb.from('network_partner_interactions')
      .select('partner_id, summary')
      .in('partner_id', partnerIds)
      .ilike('summary', '[DRAFT CN-06B%');
    for (const d of drafts ?? []) draftIds.add(d.partner_id);
  }

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/partners/first-wave">
      <SectionHeader
        eyebrow="CN-06A"
        title="First-wave prospects"
        description={
          <span>
            {partners.length} prospects flagged for the opening outreach wave. Average fit score {avgFit ? Math.round(avgFit) : '—'}. All outreach is operator-reviewed; the system never sends.
          </span>
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners">All prospects</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/categories">Categories</Link>
          </span>
        }
      />
      <Panel title={`First-wave list (${partners.length})`} eyebrow="Ranked by fit score + contact readiness">
        <Table
          rows={partners}
          columns={[
            { key: 'fit', header: 'Fit', className: 'num', render: (r) => r.fit_score != null ? <strong>{r.fit_score}</strong> : <span className="col-dim">—</span> },
            { key: 'name', header: 'Partner', render: (r) => (
              <span>
                <Link href={`/admin/partners/${r.id}`}><strong>{r.display_name}</strong></Link>
                {r.website && <> · <a href={r.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11 }}>site</a></>}
              </span>
            ) },
            { key: 'category', header: 'Category', render: (r) => <span style={{ fontSize: 12 }}>{categoryLabel(r.vendor_category)}</span> },
            { key: 'signal', header: 'Contact route', render: (r) => {
              const s = signals.get(r.id);
              if (!s) return <span className="col-dim">none</span>;
              return (
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  {s.named && s.email && <StatusBadge state="success" label="named+email" />}
                  {s.named && !s.email && <StatusBadge state="info" label="named" />}
                  {!s.named && s.email && <StatusBadge state="info" label="email" />}
                  {!s.named && !s.email && s.form && <StatusBadge state="warning" label="form only" />}
                </span>
              );
            } },
            { key: 'draft', header: 'Draft', render: (r) => draftIds.has(r.id) ? <StatusBadge state="warning" label="wave-1 draft" /> : <span className="col-dim">—</span> },
            { key: 'rec', header: 'Price', className: 'num', render: (r) => r.recommended_price_minor != null ? `£${(r.recommended_price_minor / 100).toLocaleString()}/mo` : <span className="col-dim">—</span> },
            { key: 'status', header: 'Stage', render: (r) => <StatusBadge state={r.status === 'won' ? 'success' : r.status === 'lost' ? 'failed' : 'info'} label={r.status.replace(/_/g, ' ')} /> },
            { key: 'contact', header: 'Last contact', render: (r) => <span className="col-dim" style={{ fontSize: 11 }}>{r.last_contact_at ? formatRelative(r.last_contact_at) : 'Never'}</span> },
          ]}
          empty={<span className="col-dim">No first-wave prospects flagged yet. Set the First-wave flag on a partner profile.</span>}
        />
      </Panel>
    </AdminShell>
  );
}
