import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, Notice } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RiskClass =
  | 'catalogue_corroborated'
  | 'internally_consistent'
  | 'ambiguous_variant'
  | 'conflicting_identity'
  | 'pricing_restriction'
  | 'unverifiable';

const RISK_LABELS: Record<RiskClass, string> = {
  catalogue_corroborated: 'Catalogue-corroborated',
  internally_consistent: 'Internally consistent',
  ambiguous_variant: 'Ambiguous / duplicate target',
  conflicting_identity: 'Conflicting identity',
  pricing_restriction: 'Pricing restriction needed',
  unverifiable: 'Unverifiable',
};

const RISK_TONE: Record<RiskClass, 'success' | 'info' | 'warning' | 'danger'> = {
  catalogue_corroborated: 'success',
  internally_consistent: 'info',
  ambiguous_variant: 'warning',
  conflicting_identity: 'danger',
  pricing_restriction: 'warning',
  unverifiable: 'warning',
};

interface QaRow {
  id: string;
  mapping_id: string;
  pp_card_slug: string;
  tcg_card_id: string | null;
  tcg_printing_key: string | null;
  risk_class: RiskClass;
  prior_pricing_eligibility: string | null;
  recommended_pricing_eligibility: string | null;
  has_tcgplayer_ref: boolean;
  has_cardmarket_ref: boolean;
  name_exact_match: boolean;
  number_exact_match: boolean;
  set_match: boolean;
  language_match: boolean;
  image_available: boolean;
  market_price_available: boolean;
  single_printing: boolean;
  sibling_printings: string[] | null;
  evidence: {
    pp?: { name?: string; set?: string; language?: string; extracted_number?: string };
    tcg?: { name?: string; set?: string; language?: string; collector_number?: string; printing_key?: string; card_id?: string };
    external_ids?: Record<string, unknown> | null;
    sibling_printings?: string[];
  };
  warnings: string[] | null;
}

export default async function QaReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const classFilter = (sp.class as RiskClass | undefined);
  const limit = Math.min(Math.max(Number(sp.limit) || 25, 10), 100);
  const offset = Math.max(Number(sp.offset) || 0, 0);

  const { admin, sb } = await requireAdmin('/admin/pokemon-matching/qa-review');
  const sites = await listNetworkSites(sb);

  // Headline counts
  const classes: RiskClass[] = ['catalogue_corroborated', 'internally_consistent', 'ambiguous_variant', 'conflicting_identity', 'pricing_restriction', 'unverifiable'];
  const counts: Partial<Record<RiskClass, number>> = {};
  for (const c of classes) {
    const { count } = await sb.from('pokemon_tcg_mapping_qa')
      .select('mapping_id', { count: 'exact', head: true })
      .eq('risk_class', c);
    counts[c] = count ?? 0;
  }
  const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);

  // Default view = pricing_restriction (operator priority) when no class filter is set
  const effectiveClass: RiskClass = classFilter ?? 'pricing_restriction';

  const { data: qaRows } = await sb.from('pokemon_tcg_mapping_qa')
    .select('*')
    .eq('risk_class', effectiveClass)
    .order('pp_card_slug')
    .range(offset, offset + limit - 1);

  const rows = (qaRows as QaRow[]) || [];
  const slugs = rows.map(r => r.pp_card_slug);
  const cardIds = rows.map(r => r.tcg_card_id).filter((x): x is string => Boolean(x));

  // Join: PP card image + commercial rank
  const { data: ppCards } = await sb.from('cards')
    .select('card_slug, card_name, set_name, card_number, image_url, pc_url, language')
    .in('card_slug', slugs);
  const ppByCard = new Map((ppCards || []).map((c: any) => [c.card_slug, c as any]));

  // Join: TCG image
  const { data: tcgCards } = await sb.from('pokemon_tcg_provider_cards')
    .select('tcg_card_id, tcg_printing_key, image_normal')
    .in('tcg_card_id', cardIds);
  const tcgByKey = new Map((tcgCards || []).map((c: any) => [`${c.tcg_card_id}|${c.tcg_printing_key}`, c as any]));

  // Downgrades summary
  const { count: downgradeMarketOnlyCount } = await sb.from('pokemon_tcg_mapping_qa')
    .select('mapping_id', { count: 'exact', head: true })
    .eq('prior_pricing_eligibility', 'bulk_safe')
    .eq('recommended_pricing_eligibility', 'market_only');
  const { count: downgradeIdentityOnlyCount } = await sb.from('pokemon_tcg_mapping_qa')
    .select('mapping_id', { count: 'exact', head: true })
    .eq('prior_pricing_eligibility', 'bulk_safe')
    .eq('recommended_pricing_eligibility', 'identity_only');

  const bulkApproveReady = counts.catalogue_corroborated ?? 0;
  const operatorReviewTotal = (counts.ambiguous_variant ?? 0) + (counts.conflicting_identity ?? 0) + (counts.pricing_restriction ?? 0) + (counts.unverifiable ?? 0);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/pokemon-matching/qa-review">
      <div style={{ marginBottom: 8 }}>
        <Link href="/admin/pokemon-matching" style={{ fontSize: 12, color: '#666' }}>← Back to matching workbench</Link>
      </div>
      <SectionHeader
        eyebrow="PP-TCG-MATCH"
        title="Automated QA review"
        description={`Full-cohort automated audit of ${total.toLocaleString()} mappings. Identity-safe approval and pricing-eligibility correction are SEPARATE operator decisions (see §4 of the reconciliation doc).`}
      />

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div className="metric-card"><div className="metric-label">Total audited</div><div className="metric-value">{total.toLocaleString()}</div></div>
        <div className="metric-card"><div className="metric-label">Bulk-approve ready</div><div className="metric-value" style={{ color: '#2d7a46' }}>{bulkApproveReady.toLocaleString()}</div></div>
        <div className="metric-card"><div className="metric-label">Operator review</div><div className="metric-value" style={{ color: '#b56a10' }}>{operatorReviewTotal.toLocaleString()}</div></div>
        <div className="metric-card"><div className="metric-label">bulk_safe → market_only</div><div className="metric-value">{(downgradeMarketOnlyCount ?? 0).toLocaleString()}</div></div>
        <div className="metric-card"><div className="metric-label">bulk_safe → identity_only</div><div className="metric-value">{(downgradeIdentityOnlyCount ?? 0).toLocaleString()}</div></div>
      </section>

      <Notice tone="info">
        The automated QA runs ten deterministic checks per mapping — name, number, set, language,
        image availability, market-feed presence, printing-contamination risk, and independent
        marketplace references (TCGplayer / Cardmarket). The <code>pricing_restriction</code> class
        contains mappings whose <em>identity</em> is correct but whose TCG card has multiple printings,
        making the card-level graded aggregate unsafe. These should be downgraded to <code>market_only</code>
        rather than approved for bulk pricing.
      </Notice>

      <div style={{ height: 16 }} />

      <Panel title="Risk-class breakdown">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '8px 0' }}>
          {classes.map(c => {
            const n = counts[c] ?? 0;
            const active = c === effectiveClass;
            return (
              <Link
                key={c}
                href={`/admin/pokemon-matching/qa-review?class=${c}`}
                style={{
                  padding: '8px 12px',
                  border: active ? '2px solid #0a66c2' : '1px solid #ddd',
                  borderRadius: 6,
                  textDecoration: 'none',
                  color: 'inherit',
                  background: active ? '#e8f0fa' : '#fff',
                  minWidth: 200,
                }}
              >
                <div style={{ fontSize: 12, color: '#666' }}>{RISK_LABELS[c]}</div>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{n.toLocaleString()}</div>
                <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>
                  tone: {RISK_TONE[c]}
                </div>
              </Link>
            );
          })}
        </div>
      </Panel>

      <div style={{ height: 16 }} />

      <Panel title={`${RISK_LABELS[effectiveClass]} · showing ${rows.length} of ${(counts[effectiveClass] ?? 0).toLocaleString()}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>No mappings in this risk class.</div>
          )}
          {rows.map(r => {
            const pp = ppByCard.get(r.pp_card_slug) as any;
            const tcg = r.tcg_card_id && r.tcg_printing_key ? tcgByKey.get(`${r.tcg_card_id}|${r.tcg_printing_key}`) : null;
            const ppNameEv = r.evidence?.pp?.name ?? r.pp_card_slug;
            const tcgNameEv = r.evidence?.tcg?.name ?? '—';
            const ppSetEv = r.evidence?.pp?.set ?? '—';
            const tcgSetEv = r.evidence?.tcg?.set ?? '—';
            const ppLangEv = r.evidence?.pp?.language ?? '—';
            const tcgLangEv = r.evidence?.tcg?.language ?? '—';
            const ppNumEv = r.evidence?.pp?.extracted_number ?? '—';
            const tcgNumEv = r.evidence?.tcg?.collector_number ?? '—';
            const siblings = r.sibling_printings ?? r.evidence?.sibling_printings ?? [];

            const ppUrl = pp?.pc_url || `https://www.pokeprices.io/card/${r.pp_card_slug}`;

            return (
              <div
                key={r.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr 1fr 140px',
                  gap: 14,
                  padding: 14,
                  border: '1px solid #e4e4e7',
                  borderRadius: 8,
                  background: '#fff',
                }}
              >
                {/* PP image */}
                <div>
                  <div style={{ fontSize: 10, color: '#999', marginBottom: 4 }}>PokePrices</div>
                  {pp?.image_url ? (
                    <img src={pp.image_url} alt="PP" style={{ width: 130, height: 'auto', borderRadius: 4, border: '1px solid #ddd' }} />
                  ) : (
                    <div style={{ width: 130, height: 180, background: '#f1f1f1', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 11 }}>no image</div>
                  )}
                </div>

                {/* PP identity */}
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    <a href={ppUrl} target="_blank" rel="noreferrer" style={{ color: '#0a66c2' }}>
                      {ppNameEv}
                    </a>
                  </div>
                  <div style={{ color: '#666', marginBottom: 2 }}>slug: <code>{r.pp_card_slug}</code></div>
                  <KeyValue label="Set" ppValue={ppSetEv} tcgValue={tcgSetEv} match={r.set_match} />
                  <KeyValue label="Number" ppValue={ppNumEv} tcgValue={tcgNumEv} match={r.number_exact_match} />
                  <KeyValue label="Language" ppValue={ppLangEv} tcgValue={tcgLangEv} match={r.language_match} />
                  <KeyValue label="Name" ppValue={ppNameEv} tcgValue={tcgNameEv} match={r.name_exact_match} />

                  <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Badge tone={r.has_tcgplayer_ref ? 'success' : 'muted'}>TCGplayer{r.has_tcgplayer_ref ? ' ✓' : ' —'}</Badge>
                    <Badge tone={r.has_cardmarket_ref ? 'success' : 'muted'}>Cardmarket{r.has_cardmarket_ref ? ' ✓' : ' —'}</Badge>
                    <Badge tone={r.image_available ? 'success' : 'warning'}>image{r.image_available ? '' : ' ✗'}</Badge>
                    <Badge tone={r.market_price_available ? 'success' : 'warning'}>market{r.market_price_available ? '' : ' ✗'}</Badge>
                  </div>
                </div>

                {/* TCGGraph identity */}
                <div style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>TCGGraph target</div>
                  <div style={{ color: '#666', marginBottom: 2 }}>card_id: <code>{r.tcg_card_id ?? '—'}</code></div>
                  <div style={{ color: '#666', marginBottom: 2 }}>printing: <code>{r.tcg_printing_key ?? '—'}</code></div>
                  {siblings.length > 1 && (
                    <div style={{ marginTop: 6, padding: 6, background: '#fff8e8', border: '1px solid #e4c882', borderRadius: 4 }}>
                      <div style={{ fontSize: 10, color: '#8a6a16', marginBottom: 3 }}>⚠ MULTIPLE PRINTINGS ON THIS CARD</div>
                      <div style={{ fontSize: 11, color: '#5a4a0a' }}>{siblings.join(' · ')}</div>
                      <div style={{ fontSize: 10, color: '#8a6a16', marginTop: 4 }}>Card-level graded aggregate is contaminated by sibling printings.</div>
                    </div>
                  )}
                  <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Badge tone={r.prior_pricing_eligibility === 'bulk_safe' ? 'info' : 'muted'}>prior: {r.prior_pricing_eligibility ?? '—'}</Badge>
                    <Badge tone={r.recommended_pricing_eligibility !== r.prior_pricing_eligibility ? 'warning' : 'success'}>
                      recommended: {r.recommended_pricing_eligibility ?? '—'}
                    </Badge>
                  </div>
                </div>

                {/* TCG image */}
                <div>
                  <div style={{ fontSize: 10, color: '#999', marginBottom: 4 }}>TCGGraph</div>
                  {tcg?.image_normal ? (
                    <img src={tcg.image_normal} alt="TCG" style={{ width: 130, height: 'auto', borderRadius: 4, border: '1px solid #ddd' }} />
                  ) : (
                    <div style={{ width: 130, height: 180, background: '#f1f1f1', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 11 }}>no image</div>
                  )}
                </div>

                {/* Warnings bar across full width */}
                {(r.warnings && r.warnings.length > 0) && (
                  <div style={{ gridColumn: '1 / -1', padding: 8, background: '#fdf4ec', borderRadius: 4, fontSize: 11, color: '#8a3f0e' }}>
                    {r.warnings.map((w, i) => <div key={i}>• {w}</div>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
          {offset > 0 && (
            <Link href={`/admin/pokemon-matching/qa-review?class=${effectiveClass}&offset=${Math.max(0, offset - limit)}&limit=${limit}`}
                  style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, textDecoration: 'none', color: 'inherit' }}>
              ← Previous
            </Link>
          )}
          <div style={{ fontSize: 12, color: '#666' }}>
            {offset + 1}–{Math.min(offset + rows.length, (counts[effectiveClass] ?? 0))} of {(counts[effectiveClass] ?? 0).toLocaleString()}
          </div>
          {offset + rows.length < (counts[effectiveClass] ?? 0) && (
            <Link href={`/admin/pokemon-matching/qa-review?class=${effectiveClass}&offset=${offset + limit}&limit=${limit}`}
                  style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, textDecoration: 'none', color: 'inherit' }}>
              Next →
            </Link>
          )}
        </div>
      </Panel>
    </AdminShell>
  );
}

function KeyValue({ label, ppValue, tcgValue, match }: { label: string; ppValue: string; tcgValue: string; match: boolean }) {
  const mismatch = ppValue !== '—' && tcgValue !== '—' && !match;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr', fontSize: 11, padding: '2px 0' }}>
      <div style={{ color: '#999' }}>{label}</div>
      <div style={{ color: mismatch ? '#c22' : 'inherit', fontWeight: mismatch ? 500 : 400 }}>{ppValue}</div>
      <div style={{ color: mismatch ? '#c22' : 'inherit', fontWeight: mismatch ? 500 : 400 }}>{tcgValue}</div>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'success' | 'info' | 'warning' | 'danger' | 'muted' }) {
  const bg = tone === 'success' ? '#e8f5ec'
    : tone === 'info' ? '#e6f0f8'
    : tone === 'warning' ? '#fdf4ec'
    : tone === 'danger' ? '#fdecec'
    : '#f1f1f1';
  const fg = tone === 'success' ? '#2d7a46'
    : tone === 'info' ? '#0a66c2'
    : tone === 'warning' ? '#8a3f0e'
    : tone === 'danger' ? '#8a0e0e'
    : '#666';
  return (
    <span style={{ padding: '2px 7px', background: bg, color: fg, borderRadius: 10, fontSize: 10, fontWeight: 500 }}>
      {children}
    </span>
  );
}
