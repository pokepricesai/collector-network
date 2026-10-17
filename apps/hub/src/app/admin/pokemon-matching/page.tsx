import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, MetricCard, StatusBadge, Table, Notice, FilterBar } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  fetchStatusCounts, listMappings, listSetAliases,
  type MappingRow, type ReviewStatus, type Confidence,
  type PricingEligibility, type FilterPreset,
} from '@/server/pokemon-matching/queries';
import BulkApproveForm from './BulkApproveForm';
import SetAliasPanel from './SetAliasPanel';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  searchParams: Promise<{
    status?: ReviewStatus | 'all';
    confidence?: Exclude<Confidence, null> | 'all';
    language?: 'en' | 'jp' | 'all';
    pricing_eligibility?: PricingEligibility | 'all';
    preset?: FilterPreset;
    sort?: 'default' | 'commercial';
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
  const pricing_eligibility = sp.pricing_eligibility ?? 'all';
  const preset = sp.preset ?? 'none';
  const sort = sp.sort ?? 'default';
  const search = sp.search ?? '';
  const page = Math.max(Number(sp.page ?? 1), 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [counts, listResult, aliases] = await Promise.all([
    fetchStatusCounts(sb),
    listMappings(sb, { status, confidence, language, pricing_eligibility, preset, sort, search, limit: PAGE_SIZE, offset }),
    listSetAliases(sb),
  ]);

  const buildHref = (overrides: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    const curr = { status, confidence, language, pricing_eligibility, preset, sort, search, page: String(page), ...overrides };
    for (const [k, v] of Object.entries(curr)) {
      if (v != null && String(v).length > 0 && v !== 'all' && v !== 'none' && v !== 'default') q.set(k, String(v));
    }
    const qs = q.toString();
    return `/admin/pokemon-matching${qs ? `?${qs}` : ''}`;
  };

  const totalPages = Math.max(1, Math.ceil(listResult.total / PAGE_SIZE));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/pokemon-matching">
      <SectionHeader
        eyebrow="Operations · PP-TCG-MATCH-01A"
        title="Pokémon → TCGGraph matching"
        description="Progressively map PokePrices records. Approvals are persisted. No live pricing is changed."
      />

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
        <MetricCard label="PP records total" value={counts.total.toLocaleString()} />
        <MetricCard label="Approved" value={(counts.by_status.approved || 0).toLocaleString()} helper={counts.total ? `${((counts.by_status.approved || 0) / counts.total * 100).toFixed(1)}%` : undefined} />
        <MetricCard label="Pending review" value={(counts.by_status.pending_review || 0).toLocaleString()} />
        <MetricCard label="Unmatched" value={(counts.by_status.unmatched || 0).toLocaleString()} />
        <MetricCard label="Rejected" value={(counts.by_status.rejected || 0).toLocaleString()} />
        <MetricCard label="No TCG equivalent" value={(counts.by_status.no_tcg_equivalent || 0).toLocaleString()} />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
        <MetricCard label="bulk_safe pending" value={counts.bulk_safe_pending.toLocaleString()} state="ok" helper="Clean normal printing" />
        <MetricCard label="market_only pending" value={counts.market_only_pending.toLocaleString()} helper="Variant printing — market quotes only" />
        <MetricCard label="identity_only pending" value={counts.identity_only_pending.toLocaleString()} helper="Variant or clash — manual" />
        <MetricCard label="verified pending (total)" value={counts.verified_pending_bulk.toLocaleString()} helper="all pricing_eligibility" />
      </section>

      <Notice tone="info">
        Approvals in this workbench do not switch live pricing. Phase-8 activation (reading TCGGraph prices onto PokePrices
        pages) is intentionally disabled. Public URLs, SEO, images and <code>card_trends</code> are untouched.
      </Notice>

      <div style={{ height: 16 }} />

      <Panel title="Bulk approve" eyebrow="Resumable + idempotent · requires pricing_eligibility=bulk_safe">
        <BulkApproveForm initialEligible={counts.bulk_safe_pending} />
      </Panel>

      <div style={{ height: 16 }} />

      <Panel title={`Set aliases (${aliases.length})`} eyebrow="Resolves broad PP sets to specific TCGGraph set codes">
        <SetAliasPanel initialAliases={aliases} />
      </Panel>

      <div style={{ height: 16 }} />

      <Panel title="Mapping queue" eyebrow="Filterable list">
        <FilterBar>
          <form method="GET" action="/admin/pokemon-matching" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
              <span>Preset</span>
              <select name="preset" defaultValue={preset} className="ui-select">
                <option value="none">(none)</option>
                <option value="promos">Promos</option>
                <option value="japanese">Japanese</option>
                <option value="vintage">Vintage/WOTC</option>
                <option value="unsupported_variants">Unsupported variants</option>
                <option value="needs_review">Needs review</option>
                <option value="no_equivalent">No TCG equivalent</option>
                <option value="high_traffic">High traffic (GSC)</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
              <span>Status</span>
              <select name="status" defaultValue={status} className="ui-select">
                <option value="all">All</option>
                <option value="pending_review">Pending review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="unmatched">Unmatched</option>
                <option value="no_tcg_equivalent">No TCG equivalent</option>
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
              <span>Pricing eligibility</span>
              <select name="pricing_eligibility" defaultValue={pricing_eligibility} className="ui-select">
                <option value="all">All</option>
                <option value="bulk_safe">bulk_safe</option>
                <option value="market_only">market_only</option>
                <option value="identity_only">identity_only</option>
                <option value="not_eligible">not_eligible</option>
                <option value="uncertain">uncertain</option>
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
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
              <span>Sort</span>
              <select name="sort" defaultValue={sort} className="ui-select">
                <option value="default">Set + slug</option>
                <option value="commercial">High traffic first</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, flex: 1, minWidth: 220 }}>
              <span>Search</span>
              <input name="search" defaultValue={search} className="ui-input" placeholder="charizard, base set, slug…" />
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
                    {r.pp_set_name} · {r.pp_language}
                    {r.commercial_rank != null && <> · <strong>GSC #{r.commercial_rank}</strong></>}
                    {' · slug ' + r.pp_card_slug}
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
              key: 'elig',
              header: 'Pricing elig.',
              render: (r) => r.pricing_eligibility ? <StatusBadge state={({
                bulk_safe: 'ok' as const,
                market_only: 'info' as const,
                identity_only: 'warning' as const,
                not_eligible: 'critical' as const,
                uncertain: 'pending' as const,
              })[r.pricing_eligibility] || 'info'} label={r.pricing_eligibility} /> : <span>—</span>,
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
