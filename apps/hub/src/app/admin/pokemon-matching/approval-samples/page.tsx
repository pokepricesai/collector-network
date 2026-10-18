import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, Table, StatusBadge, Notice } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import SamplePassFail from './SamplePassFail';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SampleRow {
  id: string;
  cohort: string;
  pp_card_slug: string;
  checked_at: string;
  passed: boolean | null;
  reason: string | null;
  notes: string | null;
  // Joined fields filled in-page from pokemon_tcg_mappings:
  pp_card_name?: string | null;
  pp_set_name?: string | null;
  pp_language?: string | null;
  tcg_card_id?: string | null;
  tcg_printing_key?: string | null;
  tcg_set_code?: string | null;
  tcg_name?: string | null;
  pricing_eligibility?: string | null;
  confidence?: string | null;
  commercial_rank?: number | null;
}

interface ProviderCardMeta {
  tcg_card_id: string;
  tcg_printing_key: string;
  image_normal: string | null;
}

export default async function ApprovalSamplesPage() {
  const { admin, sb } = await requireAdmin('/admin/pokemon-matching/approval-samples');
  const sites = await listNetworkSites(sb);

  // Pull samples
  const { data: samples, error } = await sb.from('pokemon_tcg_mapping_approval_samples')
    .select('*')
    .order('cohort')
    .order('pp_card_slug');
  if (error) throw new Error(`samples: ${error.message}`);
  const rows = (samples as SampleRow[]) || [];

  const slugs = Array.from(new Set(rows.map(r => r.pp_card_slug)));
  const { data: mappings } = await sb.from('pokemon_tcg_mappings')
    .select('pp_card_slug, pp_card_name, pp_set_name, pp_language, tcg_card_id, tcg_printing_key, tcg_set_code, tcg_name, confidence, pricing_eligibility, commercial_rank')
    .in('pp_card_slug', slugs);
  const mapByCard = new Map((mappings || []).map(m => [m.pp_card_slug, m as any]));

  // Pull provider images for the matched cards
  const providerKeys = (mappings || [])
    .filter((m: any) => m.tcg_card_id && m.tcg_printing_key)
    .map((m: any) => ({ id: m.tcg_card_id, pk: m.tcg_printing_key }));
  const uniqIds = Array.from(new Set(providerKeys.map(p => p.id)));
  const { data: providerCards } = await sb.from('pokemon_tcg_provider_cards')
    .select('tcg_card_id, tcg_printing_key, image_normal')
    .in('tcg_card_id', uniqIds)
    .limit(500);
  const providerByKey = new Map<string, ProviderCardMeta>((providerCards || []).map((p: any) => [`${p.tcg_card_id}|${p.tcg_printing_key}`, p as ProviderCardMeta]));

  // Enrich
  for (const r of rows) {
    const m = mapByCard.get(r.pp_card_slug) as any;
    if (m) {
      r.pp_card_name = m.pp_card_name;
      r.pp_set_name = m.pp_set_name;
      r.pp_language = m.pp_language;
      r.tcg_card_id = m.tcg_card_id;
      r.tcg_printing_key = m.tcg_printing_key;
      r.tcg_set_code = m.tcg_set_code;
      r.tcg_name = m.tcg_name;
      r.pricing_eligibility = m.pricing_eligibility;
      r.confidence = m.confidence;
      r.commercial_rank = m.commercial_rank;
    }
  }

  // Deterministic validators — automatic checks per row
  function validate(r: SampleRow): { ok: boolean; issues: string[] } {
    const issues: string[] = [];
    if (!r.tcg_card_id) issues.push('no_tcg_card_id');
    if (!r.tcg_printing_key) issues.push('no_tcg_printing_key');
    if (r.confidence !== 'verified') issues.push(`confidence=${r.confidence}`);
    if (!['bulk_safe'].includes(r.pricing_eligibility || '')) issues.push(`pricing_eligibility=${r.pricing_eligibility}`);
    const expectedTcgLang = r.pp_language === 'jp' ? 'ja' : 'en';
    // We'd need the provider card's language to assert this cross-check — skipped in this page
    const key = r.tcg_card_id && r.tcg_printing_key ? `${r.tcg_card_id}|${r.tcg_printing_key}` : null;
    if (key && !providerByKey.has(key)) issues.push('no_provider_card_row');
    return { ok: issues.length === 0, issues };
  }

  // Group counts
  const pending = rows.filter(r => r.passed === null).length;
  const passed = rows.filter(r => r.passed === true).length;
  const failed = rows.filter(r => r.passed === false).length;
  const autoClean = rows.filter(r => validate(r).ok).length;
  const autoIssues = rows.length - autoClean;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/pokemon-matching/approval-samples">
      <div style={{ marginBottom: 8 }}>
        <Link href="/admin/pokemon-matching" style={{ fontSize: 12, color: '#666' }}>← Back to matching workbench</Link>
      </div>
      <SectionHeader
        eyebrow="PP-TCG-MIGRATE-06"
        title="Pokémon mapping · approval-sample review"
        description="40 stratified bulk_safe candidates. Mark pass/fail before authorising the full bulk approve of 23,474 verified-identity mappings."
      />

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div className="metric-card"><div className="metric-label">Total samples</div><div className="metric-value">{rows.length}</div></div>
        <div className="metric-card"><div className="metric-label">Pending</div><div className="metric-value metric-value--muted">{pending}</div></div>
        <div className="metric-card"><div className="metric-label">Passed ✓</div><div className="metric-value">{passed}</div></div>
        <div className="metric-card"><div className="metric-label">Failed ✗</div><div className="metric-value">{failed}</div></div>
        <div className="metric-card"><div className="metric-label">Auto-validator clean</div><div className="metric-value">{autoClean}</div></div>
        <div className="metric-card"><div className="metric-label">Auto-validator flags</div><div className="metric-value">{autoIssues}</div></div>
      </section>

      <Notice tone="info">
        Deterministic invariants (confidence=verified, pricing_eligibility=bulk_safe, provider card row exists, printing key present)
        are checked automatically. Operator still verifies that the TCGGraph identity physically matches the PP card.
      </Notice>

      <div style={{ height: 16 }} />

      <Panel title="Samples by cohort">
        <Table<SampleRow>
          columns={[
            {
              key: 'cohort', header: 'Cohort', render: (r) =>
                <span className="status-badge status-info">{r.cohort}</span>,
            },
            {
              key: 'pp', header: 'PokePrices card', render: (r) => (
                <Link href={`https://www.pokeprices.io/admin/tcg-preview/${encodeURIComponent(r.pp_card_slug)}/full`}
                      target="_blank" rel="noreferrer"
                      style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{ fontWeight: 600 }}>{r.pp_card_name ?? r.pp_card_slug}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted, #888)' }}>
                    {r.pp_set_name ?? '—'} · {r.pp_language}
                    {r.commercial_rank != null && <> · GSC #{r.commercial_rank}</>}
                  </div>
                </Link>
              ),
            },
            {
              key: 'tcg', header: 'TCGGraph target', render: (r) => (
                <div style={{ fontSize: 12 }}>
                  <div><code>{r.tcg_card_id ?? '—'}</code> / <code>{r.tcg_printing_key ?? '—'}</code></div>
                  <div style={{ fontSize: 11, color: 'var(--muted, #888)' }}>
                    {r.tcg_set_code ?? '—'} · {r.tcg_name ?? '—'}
                  </div>
                </div>
              ),
            },
            {
              key: 'auto', header: 'Auto', render: (r) => {
                const v = validate(r);
                return v.ok
                  ? <StatusBadge state="success" label="clean" />
                  : <span className="status-badge status-warning" title={v.issues.join(', ')}>{v.issues.length} issue{v.issues.length === 1 ? '' : 's'}</span>;
              },
            },
            {
              key: 'elig', header: 'Elig.', render: (r) =>
                <code style={{ fontSize: 11 }}>{r.pricing_eligibility ?? '—'}</code>,
            },
            {
              key: 'passed', header: 'Pass/Fail', render: (r) => (
                <SamplePassFail
                  sampleId={r.id}
                  currentPassed={r.passed}
                  currentReason={r.reason}
                  previewUrl={`https://www.pokeprices.io/admin/tcg-preview/${encodeURIComponent(r.pp_card_slug)}/full`}
                />
              ),
            },
          ]}
          rows={rows}
          empty="No samples (run scripts/pp-tcg-migrate-05-approval-sample.mjs to generate)."
        />
      </Panel>
    </AdminShell>
  );
}
