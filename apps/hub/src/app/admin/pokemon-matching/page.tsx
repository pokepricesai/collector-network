import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, MetricCard, StatusBadge, Table, Notice, FilterBar } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  fetchStatusCounts, listMappings, listSetAliases,
  listIngestionRuns, listOpenSetAlerts, fetchDataHealthCounts,
  fetchIngestionCursor, fetchFxFreshness, fetchPromoProposalCount,
  fetchApprovalSampleCount,
  type MappingRow, type ReviewStatus, type Confidence,
  type PricingEligibility, type FilterPreset,
} from '@/server/pokemon-matching/queries';
import BulkApproveForm from './BulkApproveForm';
import SetAliasSection from './SetAliasSection';

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

function reviewReason(r: MappingRow): string {
  if (r.review_status === 'approved') return '—';
  if (r.review_status === 'no_tcg_equivalent') return 'no TCGGraph counterpart';
  if (r.review_status === 'unmatched') return 'matcher found no candidate';
  if (r.notes) return r.notes;
  if (r.confidence === 'verified' && r.pricing_eligibility === 'bulk_safe') return 'ready for bulk approve';
  if (r.confidence === 'verified' && r.pricing_eligibility === 'market_only') return 'variant printing — identity verified, graded prices aggregated';
  if (r.confidence === 'verified' && r.pricing_eligibility === 'identity_only') return 'identity verified; price activation unsafe (variant / promo / clash)';
  if (r.confidence === 'medium') return 'set resolution partial — manual check';
  if (r.confidence === 'low') return 'multiple candidates, no set resolution';
  return 'needs review';
}

export default async function PokemonMatchingPage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/pokemon-matching');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;

  // Queue defaults: pending_review + sort by commercial importance so
  // high-traffic cards surface first.
  const status = sp.status ?? 'pending_review';
  const confidence = sp.confidence ?? 'all';
  const language = sp.language ?? 'all';
  const pricing_eligibility = sp.pricing_eligibility ?? 'all';
  const preset = sp.preset ?? 'none';
  const sort = sp.sort ?? 'commercial';
  const search = sp.search ?? '';
  const page = Math.max(Number(sp.page ?? 1), 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [counts, listResult, aliases, ingestionRuns, openAlerts, health, cursor, fxFreshness, promoCounts, approvalSample] = await Promise.all([
    fetchStatusCounts(sb),
    listMappings(sb, { status, confidence, language, pricing_eligibility, preset, sort, search, limit: PAGE_SIZE, offset }),
    listSetAliases(sb),
    listIngestionRuns(sb, 10),
    listOpenSetAlerts(sb, 10),
    fetchDataHealthCounts(sb),
    fetchIngestionCursor(sb),
    fetchFxFreshness(sb),
    fetchPromoProposalCount(sb),
    fetchApprovalSampleCount(sb),
  ]);
  const lastRun = ingestionRuns.find(r => r.kind === 'full_catalogue') ?? ingestionRuns[0] ?? null;
  const lastDiscovery = ingestionRuns.find(r => r.kind === 'set_discovery') ?? null;
  const lastHistoryBatch = ingestionRuns.find(r => r.kind === 'history_batch') ?? null;

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

  // Derived numbers for the overview
  const total = counts.total;
  const approved = counts.by_status.approved || 0;
  const pending = counts.by_status.pending_review || 0;
  const unmatched = counts.by_status.unmatched || 0;
  const noEquivalent = counts.by_status.no_tcg_equivalent || 0;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/pokemon-matching">
      <SectionHeader
        eyebrow="Operations · PP-TCG-MATCH-02"
        title="Pokémon → TCGGraph matching"
        description="Automated identity matching plus a manual queue for exceptions. Approvals are persisted. No live pricing is changed."
      />

      {/* A — Matching overview */}
      <Panel title="Matching overview" eyebrow="A · live counts">
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <MetricCard label="Total cards" value={total.toLocaleString()} />
          <MetricCard label="Automatically verified" value={(counts.by_pricing_eligibility.bulk_safe + counts.by_pricing_eligibility.market_only + counts.by_pricing_eligibility.identity_only).toLocaleString()} helper={`${(((counts.by_pricing_eligibility.bulk_safe + counts.by_pricing_eligibility.market_only + counts.by_pricing_eligibility.identity_only) / Math.max(total, 1)) * 100).toFixed(1)}%`} state="ok" />
          <MetricCard label="Price-compatible (bulk_safe)" value={counts.by_pricing_eligibility.bulk_safe.toLocaleString()} />
          <MetricCard label="Variant restricted (market_only)" value={counts.by_pricing_eligibility.market_only.toLocaleString()} />
          <MetricCard label="Identity-only / unsafe price" value={counts.by_pricing_eligibility.identity_only.toLocaleString()} />
          <MetricCard label="Awaiting manual review" value={counts.by_pricing_eligibility.uncertain.toLocaleString()} />
          <MetricCard label="No TCG equivalent" value={noEquivalent.toLocaleString()} />
          <MetricCard label="Approved" value={approved.toLocaleString()} />
        </section>
      </Panel>

      <div style={{ height: 16 }} />

      {/* B — Automatic matching */}
      <Panel title="Automatic matching" eyebrow="B · one explicit, resumable bulk approve">
        <BulkApproveForm initialEligible={counts.bulk_safe_pending} />
      </Panel>

      <div style={{ height: 16 }} />

      <Notice tone="info">
        Approvals in this workbench do not switch live pricing. Phase-8 activation (reading TCGGraph prices onto
        PokePrices pages) is intentionally disabled. Public URLs, SEO, images and <code>card_trends</code> are
        untouched.
      </Notice>

      <div style={{ height: 16 }} />

      {/* NEW: Data Health panel */}
      <Panel title="Data health · TCGGraph ingestion" eyebrow="PP-TCG-MIGRATE-04 · chunked daily ingestion + FX + promo proposals">
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <MetricCard label="Provider cards ingested" value={health.provider_cards.toLocaleString()} helper="(card × printing_key)" />
          <MetricCard label="Market price rows" value={health.prices_market.toLocaleString()} />
          <MetricCard label="Graded price rows" value={health.prices_graded.toLocaleString()} />
          <MetricCard label="bulk_safe w/ provider match" value={health.bulk_safe_with_provider_price.toLocaleString()} state="ok" />
          <MetricCard label="Open set alerts" value={health.open_set_alerts.toLocaleString()} state={health.open_set_alerts > 0 ? 'ok' : 'muted'} />
          <MetricCard label="Promo sets · approved" value={promoCounts.approved.toLocaleString()} helper={promoCounts.needs_more_data > 0 ? `${promoCounts.needs_more_data} need more data` : undefined} state={promoCounts.approved > 0 ? 'ok' : 'muted'} />
          <MetricCard label="Approval samples pending" value={approvalSample.pending.toLocaleString()} helper={`${approvalSample.passed} ✓ / ${approvalSample.failed} ✗ / ${approvalSample.total} total`} />
          <MetricCard label="FX USD→EUR (latest)" value={fxFreshness.usd_eur != null ? fxFreshness.usd_eur.toFixed(4) : 'none'} helper={fxFreshness.as_of ?? undefined} state={fxFreshness.as_of ? 'ok' : 'muted'} />
        </section>

        {cursor && (
          <div style={{ marginTop: 14, padding: 10, background: '#f6f8fa', border: '1px solid #d0d7de', borderRadius: 4, fontSize: 12 }}>
            <strong>Chunked daily ingestion cursor</strong>
            <div style={{ marginTop: 4, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
              <div>state: <StatusBadge state={cursor.state === 'running' ? 'running' : cursor.state === 'completed_for_day' ? 'success' : cursor.state === 'failed' ? 'failed' : 'info'} label={cursor.state} /></div>
              <div>last set: <code>{cursor.last_set_code ?? '—'}</code> ({cursor.last_language ?? '—'})</div>
              <div>cycle started: {cursor.cycle_started_at ? new Date(cursor.cycle_started_at).toLocaleString() : '—'}</div>
              <div>cycle credits: <strong>{cursor.cycle_credits_spent.toLocaleString()}</strong></div>
              <div>sets processed this cycle: <strong>{cursor.cycle_sets_processed}</strong> / 683</div>
              <div>cards upserted this cycle: <strong>{cursor.cycle_cards_upserted.toLocaleString()}</strong></div>
            </div>
            {cursor.cycle_completed_at && (
              <div style={{ marginTop: 4, color: '#1a5c1a' }}>cycle completed: {new Date(cursor.cycle_completed_at).toLocaleString()}</div>
            )}
          </div>
        )}
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ padding: 10, background: '#f6f8fa', border: '1px solid #d0d7de', borderRadius: 4, fontSize: 12 }}>
            <strong>Last full catalogue ingestion</strong>
            {lastRun ? (
              <div style={{ marginTop: 4 }}>
                <div>state: <StatusBadge state={lastRun.state === 'completed' ? 'success' : lastRun.state === 'failed' ? 'failed' : lastRun.state === 'running' ? 'running' : 'info'} label={lastRun.state} /></div>
                <div>started: {new Date(lastRun.started_at).toLocaleString()}</div>
                {lastRun.finished_at && <div>finished: {new Date(lastRun.finished_at).toLocaleString()}</div>}
                <div>credits: {lastRun.credits_spent.toLocaleString()} · requests: {lastRun.requests_made.toLocaleString()}</div>
                <div>cards: {lastRun.cards_ingested.toLocaleString()} · market: {lastRun.prices_market_rows.toLocaleString()} · graded: {lastRun.prices_graded_rows.toLocaleString()}</div>
                {lastRun.error_message && <div style={{ color: '#8b1a1a', marginTop: 4 }}>error: {lastRun.error_message}</div>}
              </div>
            ) : <div style={{ marginTop: 4, color: '#666' }}>no runs yet · run <code>node scripts/pp-tcg-migrate-01-ingest.mjs</code> manually</div>}
          </div>
          <div style={{ padding: 10, background: '#f6f8fa', border: '1px solid #d0d7de', borderRadius: 4, fontSize: 12 }}>
            <strong>Last set-discovery run</strong>
            {lastDiscovery ? (
              <div style={{ marginTop: 4 }}>
                <div>state: <StatusBadge state={lastDiscovery.state === 'completed' ? 'success' : lastDiscovery.state === 'failed' ? 'failed' : 'info'} label={lastDiscovery.state} /></div>
                <div>started: {new Date(lastDiscovery.started_at).toLocaleString()}</div>
                <div>credits: {lastDiscovery.credits_spent.toLocaleString()} · sets seen: {lastDiscovery.sets_observed.toLocaleString()} · alerts opened: {lastDiscovery.alerts_opened.toLocaleString()}</div>
              </div>
            ) : <div style={{ marginTop: 4, color: '#666' }}>no discovery runs yet · run <code>node scripts/pp-tcg-migrate-01-discover.mjs</code> manually</div>}
          </div>
        </div>
        {openAlerts.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Open set alerts ({openAlerts.length})</div>
            <div style={{ fontSize: 12, maxHeight: 180, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 4 }}>
              {openAlerts.map(a => (
                <div key={a.id} style={{ padding: '6px 10px', borderBottom: '1px solid #eee' }}>
                  <StatusBadge state="info" label={a.kind} />
                  <strong style={{ marginLeft: 6 }}>{a.tcg_set_code}</strong> {a.tcg_set_name} ({a.tcg_language}) · first seen {new Date(a.first_seen_at).toLocaleString()}
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <div style={{ height: 16 }} />

      {/* C — Cards needing my review */}
      <Panel title={`Cards needing my review (${listResult.total.toLocaleString()})`} eyebrow="C · prioritised by commercial importance">
        <FilterBar>
          <form method="GET" action="/admin/pokemon-matching" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
              <span>Preset</span>
              <select name="preset" defaultValue={preset} className="ui-select">
                <option value="none">(none)</option>
                <option value="promos">Promos</option>
                <option value="japanese">Japanese</option>
                <option value="vintage">Vintage/WOTC</option>
                <option value="unsupported_variants">Conflicting variants</option>
                <option value="high_traffic">High traffic (GSC)</option>
                <option value="needs_review">Needs review</option>
                <option value="no_equivalent">No TCG equivalent</option>
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
                <option value="commercial">High traffic first</option>
                <option value="default">Set + slug</option>
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
                <Link href={`/admin/pokemon-matching/${encodeURIComponent(r.pp_card_slug)}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                  <div style={{ fontWeight: 600 }}>{r.pp_card_name || r.pp_card_slug}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted, #888)' }}>
                    {r.pp_set_name} · {r.pp_language}
                    {r.commercial_rank != null && <> · <strong>GSC #{r.commercial_rank}</strong></>}
                  </div>
                </Link>
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
                verified: 'ok' as const, high: 'approved' as const, medium: 'info' as const, low: 'warning' as const,
              })[r.confidence] || 'info'} label={r.confidence} /> : <span>—</span>,
            },
            {
              key: 'reason',
              header: 'Reason review needed',
              render: (r) => <span style={{ fontSize: 11, color: '#555' }}>{reviewReason(r)}</span>,
            },
            {
              key: 'elig',
              header: 'Pricing',
              render: (r) => r.pricing_eligibility ? <StatusBadge state={({
                bulk_safe: 'ok' as const, market_only: 'info' as const, identity_only: 'warning' as const,
                not_eligible: 'critical' as const, uncertain: 'pending' as const,
              })[r.pricing_eligibility] || 'info'} label={r.pricing_eligibility} /> : <span>—</span>,
            },
            {
              key: 'status',
              header: 'Status',
              render: (r) => <StatusBadge
                state={({
                  approved: 'approved' as const, pending_review: 'pending' as const, rejected: 'rejected' as const,
                  unmatched: 'warning' as const, no_tcg_equivalent: 'info' as const,
                  needs_price_verification: 'in_progress' as const,
                })[r.review_status] || 'pending'}
                label={r.review_status.replace(/_/g, ' ')}
              />,
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

      <div style={{ height: 16 }} />

      {/* D — Set-alias management (collapsible, secondary) */}
      <SetAliasSection initialAliases={aliases} />
    </AdminShell>
  );
}
