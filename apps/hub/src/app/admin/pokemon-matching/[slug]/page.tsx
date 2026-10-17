import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Notice } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  getMappingBySlug,
  listCandidatesForSlug,
  getPpCardBySlug,
  getPpTrendBySlug,
} from '@/server/pokemon-matching/queries';
import ReviewActions from './ReviewActions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ slug: string }>;
}

function formatPpPrice(cents: number | null): string {
  if (cents == null) return '—';
  const v = cents / 100;
  if (v >= 1000) return `$${Math.round(v).toLocaleString('en-US')}`;
  return `$${v.toFixed(2)}`;
}

function formatUsd(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 1000) return `$${Math.round(v).toLocaleString('en-US')}`;
  return `$${Number(v).toFixed(2)}`;
}

function formatEur(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 1000) return `€${Math.round(v).toLocaleString('en-GB')}`;
  return `€${Number(v).toFixed(2)}`;
}

export default async function MappingReviewPage({ params }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/pokemon-matching');
  const sites = await listNetworkSites(sb);
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);

  const [mapping, pp, trend, candidates] = await Promise.all([
    getMappingBySlug(sb, decoded),
    getPpCardBySlug(sb, decoded),
    getPpTrendBySlug(sb, decoded),
    listCandidatesForSlug(sb, decoded),
  ]);

  if (!mapping) notFound();

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname={`/admin/pokemon-matching/${slug}`}>
      <div style={{ marginBottom: 8 }}>
        <Link href="/admin/pokemon-matching" style={{ fontSize: 12, color: 'var(--muted, #666)' }}>← Back to queue</Link>
      </div>
      <SectionHeader
        eyebrow="PP-TCG-MATCH-01A"
        title={pp?.card_name || mapping.pp_card_name || mapping.pp_card_slug}
        description={<>
          <StatusBadge
            state={({
              approved: 'approved' as const,
              pending_review: 'pending' as const,
              rejected: 'rejected' as const,
              unmatched: 'warning' as const,
              no_tcg_equivalent: 'info' as const,
              needs_price_verification: 'in_progress' as const,
            })[mapping.review_status] || 'pending'}
            label={mapping.review_status.replace(/_/g, ' ')}
          />
          {mapping.confidence && <> · confidence <StatusBadge state="info" label={mapping.confidence} /></>}
          {mapping.pricing_eligibility && <> · pricing <StatusBadge state={({ bulk_safe: 'ok' as const, market_only: 'info' as const, identity_only: 'warning' as const, not_eligible: 'critical' as const, uncertain: 'pending' as const })[mapping.pricing_eligibility] || 'info'} label={mapping.pricing_eligibility} /></>}
          {mapping.commercial_rank != null && <> · GSC rank <strong>#{mapping.commercial_rank}</strong></>}
          {mapping.reviewed_at && <> · last reviewed {new Date(mapping.reviewed_at).toLocaleString()} by {mapping.reviewer_display}</>}
        </>}
      />

      {mapping.pricing_eligibility && mapping.pricing_eligibility !== 'bulk_safe' && mapping.pricing_eligibility !== 'not_eligible' && (
        <Notice tone="warning">
          <strong>Pricing applicability warning.</strong>{' '}
          {mapping.pricing_eligibility === 'market_only' && 'This is a variant printing. TCGGraph aggregates raw/PSA10 across printings for one card id, so those values would misreport the variant. Only per-finish TCGplayer/Cardmarket market quotes are safe to activate for pricing on this row.'}
          {mapping.pricing_eligibility === 'identity_only' && 'Card identity is verified but Phase-8 price activation is unsafe: variant tag has no TCG printing key, promo-reprint target, language mismatch, or duplicate PP-target clash.'}
          {mapping.pricing_eligibility === 'uncertain' && 'The matcher found candidates but did not reach "verified" confidence. Approving the identity is OK; price activation requires a manual override.'}
        </Notice>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* LEFT: existing PokePrices record */}
        <Panel title="PokePrices (legacy)" eyebrow="Current record">
          {pp ? (
            <div style={{ display: 'flex', gap: 12 }}>
              {pp.image_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={pp.image_url}
                  alt=""
                  style={{ width: 120, height: 'auto', borderRadius: 4, border: '1px solid #ddd' }}
                />
              )}
              <div style={{ fontSize: 13, flex: 1, display: 'grid', gap: 4 }}>
                <KV label="Slug" value={pp.card_slug} />
                <KV label="Name" value={pp.card_name} />
                <KV label="Set" value={pp.set_name} />
                <KV label="Collector #" value={pp.card_number} />
                <KV label="Language" value={pp.language} />
                <KV label="URL slug" value={pp.card_url_slug} />
                <KV label="Set release" value={pp.set_release_date} />
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #eee' }}>
                  <strong style={{ fontSize: 12, color: '#555' }}>Current PP prices (legacy — not changed)</strong>
                  <KV label="Raw" value={formatPpPrice(trend?.current_raw ?? null)} />
                  <KV label="PSA 10" value={formatPpPrice(trend?.current_psa10 ?? null)} />
                  <KV label="PSA 9" value={formatPpPrice(trend?.current_psa9 ?? null)} />
                  <KV label="As of" value={trend?.as_of ?? '—'} />
                </div>
                <div style={{ marginTop: 8 }}>
                  <a href={`https://www.pokeprices.io/set/${encodeURIComponent(pp.set_name || '')}/card/${encodeURIComponent(pp.card_url_slug || pp.card_slug)}`} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                    Open on PokePrices →
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <Notice tone="warning">
              This mapping references PP slug <code>{mapping.pp_card_slug}</code> but the <code>cards</code> row was not found. Possibly deleted.
            </Notice>
          )}
        </Panel>

        {/* RIGHT: current TCGGraph target + alternatives */}
        <Panel title="TCGGraph target" eyebrow="Suggested mapping" actions={<ReviewActions mapping={mapping} candidates={candidates} />}>
          {mapping.tcg_card_id ? (
            <div style={{ fontSize: 13, display: 'grid', gap: 4 }}>
              <KV label="TCG card id" value={mapping.tcg_card_id} />
              <KV label="Name" value={mapping.tcg_name} />
              <KV label="Set code" value={mapping.tcg_set_code} />
              <KV label="Language" value={mapping.tcg_language} />
              <KV label="Printing key" value={mapping.tcg_printing_key || 'normal'} />
              <KV label="Match method" value={mapping.match_method} />
              <KV label="Confidence" value={mapping.confidence} />
            </div>
          ) : (
            <Notice tone="warning">No TCGGraph record attached — this card is <strong>{mapping.review_status.replace(/_/g, ' ')}</strong>.</Notice>
          )}
        </Panel>
      </div>

      <div style={{ height: 16 }} />

      <Panel title={`Candidate TCGGraph records (${candidates.length})`} eyebrow="All alternatives from matcher">
        {candidates.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted, #666)', padding: 12 }}>
            No candidates found by the matcher. This card is likely a WOTC variant, Topps/McDonald&apos;s promo, or Japanese thin-market record with no TCGGraph counterpart.
            Use <em>Reject → no TCG equivalent</em> on the right if the operator is sure.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {candidates.map((c) => {
              const isCurrent = c.tcg_card_id === mapping.tcg_card_id && (c.tcg_printing_key || 'normal') === (mapping.tcg_printing_key || 'normal');
              return (
                <div key={c.id} style={{ border: '1px solid #e0e0e0', borderRadius: 4, padding: 10, background: isCurrent ? '#f1f8f1' : 'white' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{c.tcg_name || c.tcg_card_id}</div>
                      <div style={{ fontSize: 11, color: '#666' }}>
                        {c.tcg_card_id} · {c.tcg_set_code} · {c.tcg_language} · {c.tcg_printing_key || 'normal'} · #{c.tcg_collector_num ?? '?'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <StatusBadge
                        state={({ verified: 'ok' as const, high: 'approved' as const, medium: 'info' as const, low: 'warning' as const })[c.confidence] || 'info'}
                        label={c.confidence}
                      />
                      <span className="status-badge status-info">{c.match_method}</span>
                      {isCurrent && <StatusBadge state="active" label="current" />}
                    </div>
                  </div>
                  {c.reasons.length > 0 && (
                    <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
                      {c.reasons.join(' · ')}
                    </div>
                  )}
                  {c.snapshot_prices && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginTop: 8, fontSize: 11 }}>
                      <KV label="TCG raw" value={formatUsd(c.snapshot_prices.raw_ungraded_usd)} />
                      <KV label="TCG PSA 10" value={formatUsd(c.snapshot_prices.psa10_usd)} />
                      <KV label="Pooled grade 9" value={formatUsd(c.snapshot_prices.pooled9_usd)} />
                      <KV label="TCGplayer" value={formatUsd(c.snapshot_prices.tcgplayer_normal_usd)} />
                      <KV label="Cardmarket" value={formatEur(c.snapshot_prices.cardmarket_normal_eur)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </AdminShell>
  );
}

function KV({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div style={{ display: 'flex', gap: 6, fontSize: 12 }}>
      <span style={{ color: '#666', minWidth: 100 }}>{label}</span>
      <span>{value ?? '—'}</span>
    </div>
  );
}
