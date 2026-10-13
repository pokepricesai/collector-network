import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { EmptyPanelNotice } from '@/components/admin/EmptyPanelNotice';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listPartners } from '@/server/partners/queries';
import { formatDateOnly, formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{ status?: string; kind?: string }>;
}

const PIPELINE_STAGES = [
  'prospect', 'researching', 'ready_to_contact', 'contacted', 'replied',
  'meeting', 'proposal', 'negotiating', 'won', 'lost', 'nurture', 'archived',
];

export default async function PartnersPage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/partners');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const partners = await listPartners(sb, { status: sp.status, kind: sp.kind });

  const stageCounts = new Map<string, number>();
  for (const p of await listPartners(sb)) {
    stageCounts.set(p.status, (stageCounts.get(p.status) ?? 0) + 1);
  }

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/partners">
      <SectionHeader
        eyebrow="Commercial"
        title="Partner CRM"
        description="Prospects, active sponsors, grading-company contacts, LGS and marketplace integrations. Pipeline stages are human-driven — the system logs state, it never contacts anyone."
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="ui-btn ui-btn--primary ui-btn--sm" href="/admin/partners/new">+ Partner</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/offers">Offer catalogue</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/sponsorships">Sponsorships</Link>
          </span>
        }
      />
      {stageCounts.size === 0 ? (
        <Panel title="Pipeline">
          <EmptyPanelNotice>
            No partners yet. Click <strong>+ Partner</strong> at the top-right to add one, or jump to the <Link href="/admin/partners/offers">Offer catalogue</Link> and <Link href="/admin/partners/sponsorships">Sponsorships</Link>.
          </EmptyPanelNotice>
        </Panel>
      ) : (
        <Panel title="Pipeline" eyebrow="Stage counts">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PIPELINE_STAGES.filter((s) => (stageCounts.get(s) ?? 0) > 0).map((s) => {
              const n = stageCounts.get(s) ?? 0;
              return (
                <Link key={s} href={`/admin/partners?status=${s}`} style={{ textDecoration: 'none' }}>
                  <span className={`status-badge status-${s === 'won' ? 'success' : s === 'lost' ? 'failed' : s === 'archived' ? 'dismissed' : 'info'}`} style={{ cursor: 'pointer' }}>
                    {s.replace(/_/g, ' ')} · {n}
                  </span>
                </Link>
              );
            })}
            {Array.from(stageCounts.entries()).some(([_, n]) => n > 0) && (
              <Link href="/admin/partners" style={{ marginLeft: 8, fontSize: 12 }}>reset</Link>
            )}
          </div>
          {PIPELINE_STAGES.every((s) => (stageCounts.get(s) ?? 0) === 0) === false && (
            <details style={{ marginTop: 10, fontSize: 11, color: 'var(--admin-text-muted)' }}>
              <summary style={{ cursor: 'pointer' }}>All stages (including empty)</summary>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {PIPELINE_STAGES.map((s) => (
                  <Link key={`all-${s}`} href={`/admin/partners?status=${s}`} style={{ textDecoration: 'none' }}>
                    <span className="status-badge status-dismissed" style={{ cursor: 'pointer', opacity: 0.65 }}>
                      {s.replace(/_/g, ' ')} · {stageCounts.get(s) ?? 0}
                    </span>
                  </Link>
                ))}
              </div>
            </details>
          )}
        </Panel>
      )}
      <Panel title={`Partners (${partners.length})`} eyebrow={sp.status ? `Filter: ${sp.status}` : 'All stages'}>
        <Table
          rows={partners}
          columns={[
            { key: 'name', header: 'Partner', render: (r) => (
              <span>
                <Link href={`/admin/partners/${r.id}`}><strong>{r.display_name}</strong></Link>
                {' '}<code className="col-dim" style={{ fontSize: 11 }}>{r.slug}</code>
              </span>
            ) },
            { key: 'kind', header: 'Kind', render: (r) => <StatusBadge state="info" label={r.kind.replace(/_/g, ' ')} /> },
            { key: 'status', header: 'Stage', render: (r) => <StatusBadge state={r.status === 'won' ? 'success' : r.status === 'lost' ? 'failed' : r.status === 'archived' ? 'dismissed' : 'info'} label={r.status.replace(/_/g, ' ')} /> },
            { key: 'priority', header: 'P', className: 'num', render: (r) => `P${r.priority}` },
            { key: 'nextAction', header: 'Next action', render: (r) => r.next_action ? (
              <span style={{ fontSize: 12 }}>{r.next_action}{r.next_action_due && <> · <code>{formatDateOnly(r.next_action_due)}</code></>}</span>
            ) : <span className="col-dim">—</span> },
            { key: 'contact', header: 'Last contact', render: (r) => <span className="col-dim" style={{ fontSize: 11 }}>{r.last_contact_at ? formatRelative(r.last_contact_at) : 'Never'}</span> },
          ]}
          empty={<span className="col-dim">No partners match the current filter.</span>}
        />
      </Panel>
    </AdminShell>
  );
}
