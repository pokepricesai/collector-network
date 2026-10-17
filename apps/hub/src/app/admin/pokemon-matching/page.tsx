import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, MetricCard, StatusBadge, Table, Notice, FilterBar } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { fetchStatusCounts, listMappings, type MappingRow, type ReviewStatus, type Confidence } from '@/server/pokemon-matching/queries';
import BulkApproveForm from './BulkApproveForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{
    status?: ReviewStatus | 'all';
    confidence?: Exclude<Confidence, null> | 'all';
    language?: 'en' | 'jp' | 'all';
    search?: string;
    page?: string;
  }>;
}

const PAGE_SIZE = 50;

export default async function PokemonMatchingPage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/pokemon-matching');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;

  const status = sp.status ?? 'pending_review';
  const confidence = sp.confidence ?? 'all';
  const language = sp.language ?? 'all';
  const search = sp.search ?? '';
  const page = Math.max(Number(sp.page ?? 1), 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [counts, listResult] = await Promise.all([
    fetchStatusCounts(sb),
    listMappings(sb, { status, confidence, language, search, limit: PAGE_SIZE, offset }),
  ]);

  const matched = (counts.by_status.approved || 0);
  const pending = counts.by_status.pending_review || 0;
  const unmatched = counts.by_status.unmatched || 0;
  const rejected = counts.by_status.rejected || 0;
  const no_equiv = counts.by_status.no_tcg_equivalent || 0;

  const buildHref = (overrides: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    const curr = { status, confidence, language, search, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(curr)) {
      if (v != null && String(v).length > 0 && v !== 'all') q.set(k, String(v));
    }
    const qs = q.toString();
    return `/admin/pokemon-matching${qs ? `?${qs}` : ''}`;
  };

  const totalPages = Math.max(1, Math.ceil(listResult.total / PAGE_SIZE));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/pokemon-matching">
      <SectionHeader
        eyebrow="Operations · PP-TCG-MATCH-01"
        title="Pokémon → TCGGraph matching"
        description="Progressively map PokePrices records to TCGGraph. Approvals are persisted. No live pricing is changed."
      />

      <section className="admin-metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <MetricCard label="PP records total" value={counts.total.toLocaleString()} />
        <MetricCard label="Approved" value={matched.toLocaleString()} helper={counts.total ? `${(matched / counts.total * 100).toFixed(1)}%` : undefined} />
        <MetricCard label="Pending review" value={pending.toLocaleString()} helper={counts.total ? `${(pending / counts.total * 100).toFixed(1)}%` : undefined} />
        <MetricCard label="Unmatched" value={unmatched.toLocaleString()} helper={counts.total ? `${(unmatched / counts.total * 100).toFixed(1)}%` : undefined} />
        <MetricCard label="Rejected" value={rejected.toLocaleString()} />
        <MetricCard label="No TCG equivalent" value={no_equiv.toLocaleString()} />
        <MetricCard label="Verified pending (bulk-approvable)" value={counts.verified_pending_bulk.toLocaleString()} state="ok" />
      </section>

      <Notice tone="info">
        Approvals in this workbench do not switch live pricing. Phase-8 activation (reading TCGGraph prices onto PokePrices
        pages) is intentionally disabled. Public URLs, SEO, images and <code>card_trends</code> are untouched.
      </Notice>

      <div style={{ height: 16 }} />

      <Panel title="Bulk approve verified exact matches" eyebrow="High-confidence batch">
        <BulkApproveForm initialEligible={counts.verified_pending_bulk} />
      </Panel>

      <div style={{ height: 16 }} />

      <Panel title="Mapping queue" eyebrow="Filterable list">
        <FilterBar>
          <form method="GET" action="/admin/pokemon-matching" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
              <span>Status</span>
              <select name="status" defaultValue={status} className="ui-select">
                <option value="all">All</option>
                <option value="pending_review">Pending review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="unmatched">Unmatched</option>
                <option value="no_tcg_equivalent">No TCG equivalent</option>
                <option value="needs_price_verification">Needs price verification</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
              <span>Confidence</span>
              <select name="confidence" defaultValue={confidence} className="ui-select">
                <option value="all">All</option>
                <option value="verified">Verified</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
              <span>Language</span>
              <select name="language" defaultValue={language} className="ui-select">
                <option value="all">All</option>
                <option value="en">English</option>
                <option value="jp">Japanese</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, flex: 1, minWidth: 220 }}>
              <span>Search card, set or slug</span>
              <input name="search" defaultValue={search} className="ui-input" placeholder="charizard, base set, 10031606…" />
            </label>
            <button className="ui-btn ui-btn--primary" type="submit">Filter</button>
            <Link href="/admin/pokemon-matching" className="ui-btn ui-btn--ghost">Clear</Link>
          </form>
        </FilterBar>

        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted, #666)' }}>
          Showing {listResult.rows.length ? offset + 1 : 0}–{offset + listResult.rows.length} of {listResult.total.toLocaleString()}
        </div>

        <Table<MappingRow>
          columns={[
            {
              key: 'pp',
              header: 'PokePrices card',
              render: (r) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{r.pp_card_name || r.pp_card_slug}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted, #888)' }}>
                    {r.pp_set_name} · {r.pp_language} · slug {r.pp_card_slug}
                  </div>
                </div>
              ),
            },
            {
              key: 'tcg',
              header: 'TCGGraph suggestion',
              render: (r) => (
                r.tcg_card_id ? (
                  <div>
                    <div>{r.tcg_name || r.tcg_card_id}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted, #888)' }}>
                      {r.tcg_set_code} · {r.tcg_language} · {r.tcg_printing_key || 'normal'}
                    </div>
                  </div>
                ) : (
                  <span style={{ color: 'var(--muted, #888)' }}>—</span>
                )
              ),
            },
            {
              key: 'conf',
              header: 'Confidence',
              render: (r) => r.confidence ? <StatusBadge state={({
                verified: 'ok' as const,
                high: 'approved' as const,
                medium: 'info' as const,
                low: 'warning' as const,
              })[r.confidence] || 'info'} label={r.confidence} /> : <span style={{ color: 'var(--muted, #888)' }}>—</span>,
            },
            {
              key: 'status',
              header: 'Status',
              render: (r) => <StatusBadge
                state={({
                  approved: 'approved' as const,
                  pending_review: 'pending' as const,
                  rejected: 'rejected' as const,
                  unmatched: 'warning' as const,
                  no_tcg_equivalent: 'info' as const,
                  needs_price_verification: 'in_progress' as const,
                })[r.review_status] || 'pending'}
                label={r.review_status.replace(/_/g, ' ')}
              />,
            },
            {
              key: 'reviewer',
              header: 'Reviewer',
              render: (r) => r.reviewer_display ? (
                <div>
                  <div style={{ fontSize: 12 }}>{r.reviewer_display}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted, #888)' }}>
                    {r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : ''}
                  </div>
                </div>
              ) : <span style={{ color: 'var(--muted, #888)' }}>—</span>,
            },
            {
              key: 'actions',
              header: '',
              render: (r) => <Link className="ui-btn ui-btn--secondary ui-btn--sm" href={`/admin/pokemon-matching/${encodeURIComponent(r.pp_card_slug)}`}>Review</Link>,
            },
          ]}
          rows={listResult.rows}
          empty="No mappings match these filters."
        />

        {totalPages > 1 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
            {page > 1 && <Link className="ui-btn ui-btn--ghost" href={buildHref({ page: page - 1 })}>← Prev</Link>}
            <span style={{ alignSelf: 'center', fontSize: 12 }}>Page {page} / {totalPages}</span>
            {page < totalPages && <Link className="ui-btn ui-btn--ghost" href={buildHref({ page: page + 1 })}>Next →</Link>}
          </div>
        )}
      </Panel>
    </AdminShell>
  );
}
