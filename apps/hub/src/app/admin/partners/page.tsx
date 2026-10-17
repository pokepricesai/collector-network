import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { EmptyPanelNotice } from '@/components/admin/EmptyPanelNotice';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listCn06aPartners, listCategoryCounts, listVendorCategories } from '@/server/partners/cn06a-queries';
import { formatDateOnly, formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{ status?: string; kind?: string; category?: string; us?: string; wave?: string }>;
}

const PIPELINE_STAGES = [
  'prospect', 'researching', 'ready_to_contact', 'contacted', 'replied',
  'meeting', 'proposal', 'negotiating', 'won', 'lost', 'nurture', 'archived',
];

export default async function PartnersPage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/partners');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const partners = await listCn06aPartners(sb, {
    status: sp.status,
    category: sp.category,
    usOnly: sp.us === '1',
    firstWaveOnly: sp.wave === '1',
  });
  const [allPartners, categoryCounts, categories] = await Promise.all([
    listCn06aPartners(sb),
    listCategoryCounts(sb),
    listVendorCategories(sb),
  ]);
  const categoryLabel = (code: string | null): string => {
    if (!code) return '—';
    const match = categories.find((c) => c.code === code);
    return match ? match.display_name : code;
  };

  const stageCounts = new Map<string, number>();
  for (const p of allPartners) {
    stageCounts.set(p.status, (stageCounts.get(p.status) ?? 0) + 1);
  }
  const firstWaveCount = allPartners.filter((p) => p.first_wave).length;
  const usCount = allPartners.filter((p) => p.is_us_business).length;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/partners">
      <SectionHeader
        eyebrow="Commercial"
        title="Partner CRM"
        description="Prospects, active sponsors, grading-company contacts, LGS and marketplace integrations. Pipeline stages are human-driven — the system logs state, it never contacts anyone."
        actions={
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="ui-btn ui-btn--primary ui-btn--sm" href="/admin/partners/new">+ Partner</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/morning">Morning queue</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/pipeline">Kanban</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/first-wave">First-wave ({firstWaveCount})</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/categories">Categories</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/offers">Offer catalogue</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/sponsorships">Won deals</Link>
          </span>
        }
      />
      <Panel title="CN-06A quick filters" eyebrow="Vendor pipeline">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <Link href="/admin/partners" style={{ textDecoration: 'none' }}>
            <span className={`status-badge status-${!sp.us && !sp.wave && !sp.category && !sp.status ? 'active' : 'dismissed'}`}>All · {allPartners.length}</span>
          </Link>
          <Link href="/admin/partners?us=1" style={{ textDecoration: 'none' }}>
            <span className={`status-badge status-${sp.us === '1' ? 'active' : 'info'}`}>US only · {usCount}</span>
          </Link>
          <Link href="/admin/partners?wave=1" style={{ textDecoration: 'none' }}>
            <span className={`status-badge status-${sp.wave === '1' ? 'active' : 'info'}`}>First-wave · {firstWaveCount}</span>
          </Link>
          <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--admin-text-muted)' }}>Category:</span>
          {categoryCounts.slice(0, 10).map((c) => (
            <Link key={c.vendor_category} href={`/admin/partners?category=${encodeURIComponent(c.vendor_category)}`} style={{ textDecoration: 'none' }}>
              <span className={`status-badge status-${sp.category === c.vendor_category ? 'active' : 'info'}`}>
                {categoryLabel(c.vendor_category)} · {c.count}{c.avg_fit != null && <> · fit {c.avg_fit}</>}
              </span>
            </Link>
          ))}
          {categoryCounts.length > 10 && (
            <Link href="/admin/partners/categories" style={{ fontSize: 11 }}>+{categoryCounts.length - 10} more</Link>
          )}
        </div>
      </Panel>
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
      <Panel
        title={`Partners (${partners.length})`}
        eyebrow={sp.status ? `Stage: ${sp.status}` : sp.category ? `Category: ${categoryLabel(sp.category)}` : sp.wave === '1' ? 'First-wave only' : sp.us === '1' ? 'US only' : 'All'}
      >
        <Table
          rows={partners}
          columns={[
            { key: 'fit', header: 'Fit', className: 'num', render: (r) => r.fit_score != null ? <strong>{r.fit_score}</strong> : <span className="col-dim">—</span> },
            { key: 'name', header: 'Partner', render: (r) => (
              <span>
                {r.first_wave && <StatusBadge state="warning" label="WAVE 1" />}
                {' '}<Link href={`/admin/partners/${r.id}`}><strong>{r.display_name}</strong></Link>
                {' '}<code className="col-dim" style={{ fontSize: 11 }}>{r.slug}</code>
                {r.website && <> · <a href={r.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11 }}>site</a></>}
              </span>
            ) },
            { key: 'category', header: 'Category', render: (r) => r.vendor_category ? <span style={{ fontSize: 12 }}>{categoryLabel(r.vendor_category)}</span> : <StatusBadge state="info" label={r.kind.replace(/_/g, ' ')} /> },
            { key: 'tcgs', header: 'TCGs', render: (r) => r.relevant_tcgs?.length ? r.relevant_tcgs.join('·') : <span className="col-dim">—</span> },
            { key: 'us', header: 'US', render: (r) => r.is_us_business ? <span style={{ fontSize: 11 }}>{r.us_state ?? 'US'}</span> : <span className="col-dim">—</span> },
            { key: 'status', header: 'Stage', render: (r) => <StatusBadge state={r.status === 'won' ? 'success' : r.status === 'lost' ? 'failed' : r.status === 'archived' ? 'dismissed' : 'info'} label={r.status.replace(/_/g, ' ')} /> },
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
