import 'server-only';

// Commercial opportunity engine. Deterministic. Reads what already
// exists in the OS and emits candidate opportunities with stable
// dedupe keys so a re-run never duplicates.
//
// Signals in Phase 5:
//
//   sponsor_renewal_due
//     Active sponsorship whose renewal_reminder_on has arrived.
//
//   underperforming_source
//     Revenue source where the last 28d trailing total is zero or
//     has dropped more than 60% vs the prior 28d.
//
//   affiliate_optimisation
//     Site has 100+ affiliate clicks in the last 28d but zero
//     booked conversions — a missing or broken reconciliation.
//
//   revenue_gap_vs_traffic
//     Site has 10k+ sessions in 28d (from network_daily_metrics)
//     but <£10 revenue — the site is live but not monetised.
//
//   offer_gap
//     Partner is 'won' and has an active sponsorship with ZERO
//     deliverables (deal exists but no scope).
//
// Every finding writes to network_partner_opportunities with the
// dedupe_key as the collision guard. Promotion to a network_tasks
// row is an explicit admin action; the engine never creates tasks
// behind the admin's back.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface OpportunityDraft {
  kind: string;
  severity: 'critical' | 'high' | 'normal' | 'low';
  title: string;
  rationale: string;
  evidence: Record<string, unknown>;
  dedupe_key: string;
  partner_id?: string;
  site_id?: string;
  sponsorship_id?: string;
  source_id?: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function scanRenewalsDue(sb: SupabaseClient): Promise<OpportunityDraft[]> {
  const today = todayIso();
  const { data, error } = await sb.from('network_sponsorships')
    .select('id, partner_id, title, renewal_reminder_on, ends_on, status, currency, total_value_minor, network_partners(display_name)')
    .in('status', ['active', 'renewing'])
    .lte('renewal_reminder_on', today);
  if (error) throw new Error(`[opps] renewals: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    id: string; partner_id: string; title: string; renewal_reminder_on: string | null; ends_on: string | null;
    status: string; currency: string; total_value_minor: number; network_partners: { display_name: string } | null;
  }>;
  return rows.map((r) => ({
    kind: 'sponsor_renewal_due',
    severity: 'high' as const,
    title: `Renewal due: ${r.network_partners?.display_name ?? 'partner'} — ${r.title}`,
    rationale: `Reminder date ${r.renewal_reminder_on ?? '—'} has arrived${r.ends_on ? `; deal ends ${r.ends_on}` : ''}. Confirm renewal path.`,
    evidence: { sponsorship_id: r.id, reminder: r.renewal_reminder_on, ends_on: r.ends_on, status: r.status, value_minor: r.total_value_minor, currency: r.currency },
    dedupe_key: `renewal_due:${r.id}:${r.renewal_reminder_on ?? r.ends_on ?? today}`,
    partner_id: r.partner_id,
    sponsorship_id: r.id,
  }));
}

export async function scanUnderperformingSources(sb: SupabaseClient): Promise<OpportunityDraft[]> {
  const since28 = daysAgoIso(28);
  const since56 = daysAgoIso(56);
  // Pull last 56 days of revenue events; split into (0..28) and (28..56).
  const { data, error } = await sb.from('network_revenue_events')
    .select('amount_minor, currency, occurred_on, source_id, network_revenue_sources(slug, display_name, is_active)')
    .gte('occurred_on', since56);
  if (error) throw new Error(`[opps] source perf: ${error.message}`);
  type R = { amount_minor: number; currency: string; occurred_on: string; source_id: string; network_revenue_sources: { slug: string; display_name: string; is_active: boolean } | null };
  const rows = (data ?? []) as unknown as R[];
  const bucket = new Map<string, { source_id: string; slug: string; name: string; curr: number; prior: number; currency: string }>();
  for (const r of rows) {
    if (!r.network_revenue_sources?.is_active) continue;
    const key = `${r.source_id}:${r.currency}`;
    const b = bucket.get(key) ?? { source_id: r.source_id, slug: r.network_revenue_sources.slug, name: r.network_revenue_sources.display_name, curr: 0, prior: 0, currency: r.currency };
    if (r.occurred_on >= since28) b.curr += r.amount_minor; else b.prior += r.amount_minor;
    bucket.set(key, b);
  }
  const findings: OpportunityDraft[] = [];
  for (const b of bucket.values()) {
    if (b.prior === 0 && b.curr === 0) continue;
    const dropped = b.prior > 0 && b.curr / b.prior < 0.4;
    if (b.curr === 0 && b.prior > 0) {
      findings.push({
        kind: 'underperforming_source',
        severity: 'high',
        title: `${b.name}: revenue stopped in last 28d`,
        rationale: `Prior-28d: ${(b.prior / 100).toFixed(2)} ${b.currency}; last-28d: 0. Check feed / report import.`,
        evidence: { source_slug: b.slug, prior_28d_minor: b.prior, last_28d_minor: b.curr, currency: b.currency },
        dedupe_key: `underperf:${b.source_id}:${since28}`,
        source_id: b.source_id,
      });
    } else if (dropped) {
      findings.push({
        kind: 'underperforming_source',
        severity: 'normal',
        title: `${b.name}: 28d revenue down >60% vs prior`,
        rationale: `Prior-28d: ${(b.prior / 100).toFixed(2)}; last-28d: ${(b.curr / 100).toFixed(2)} (${((b.curr / b.prior) * 100).toFixed(0)}%).`,
        evidence: { source_slug: b.slug, prior_28d_minor: b.prior, last_28d_minor: b.curr, currency: b.currency },
        dedupe_key: `underperf:${b.source_id}:${since28}`,
        source_id: b.source_id,
      });
    }
  }
  return findings;
}

export async function scanAffiliateOptimisation(sb: SupabaseClient): Promise<OpportunityDraft[]> {
  const since28Iso = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
  const since28 = daysAgoIso(28);
  const [{ data: clicks, error: cErr }, { data: convs, error: nErr }] = await Promise.all([
    sb.from('network_affiliate_clicks').select('site_id, network_sites(slug, name)').gte('occurred_at', since28Iso),
    sb.from('network_affiliate_conversions').select('site_id').gte('occurred_on', since28),
  ]);
  if (cErr) throw new Error(`[opps] aff clicks: ${cErr.message}`);
  if (nErr) throw new Error(`[opps] aff convs: ${nErr.message}`);
  const clickCount = new Map<string, { site_id: string; name: string }>();
  const siteClicks = new Map<string, number>();
  for (const c of (clicks ?? []) as unknown as Array<{ site_id: string; network_sites: { slug: string; name: string } | null }>) {
    clickCount.set(c.site_id, { site_id: c.site_id, name: c.network_sites?.name ?? '—' });
    siteClicks.set(c.site_id, (siteClicks.get(c.site_id) ?? 0) + 1);
  }
  const convsBySite = new Set<string>();
  for (const r of (convs ?? []) as Array<{ site_id: string | null }>) {
    if (r.site_id) convsBySite.add(r.site_id);
  }
  const findings: OpportunityDraft[] = [];
  for (const [siteId, n] of siteClicks.entries()) {
    if (n >= 100 && !convsBySite.has(siteId)) {
      const info = clickCount.get(siteId);
      findings.push({
        kind: 'affiliate_optimisation',
        severity: 'normal',
        title: `${info?.name ?? siteId}: ${n} clicks, 0 conversions in 28d`,
        rationale: `Clicks are flowing but no conversions are being reconciled. Likely a missing CSV import.`,
        evidence: { site_id: siteId, clicks_28d: n, conversions_28d: 0 },
        dedupe_key: `aff_opt:${siteId}:${since28}`,
        site_id: siteId,
      });
    }
  }
  return findings;
}

export async function scanRevenueGapVsTraffic(sb: SupabaseClient): Promise<OpportunityDraft[]> {
  const since28 = daysAgoIso(28);
  const [{ data: metrics, error: mErr }, { data: revs, error: rErr }] = await Promise.all([
    sb.from('network_daily_metrics').select('site_id, metric, value, network_sites(slug, name)').in('metric', ['ga4_sessions', 'gsc_clicks']).gte('date', since28),
    sb.from('network_revenue_events').select('site_id, amount_minor, currency').gte('occurred_on', since28),
  ]);
  if (mErr) throw new Error(`[opps] metrics: ${mErr.message}`);
  if (rErr) throw new Error(`[opps] rev: ${rErr.message}`);
  const sessionsBySite = new Map<string, { site_id: string; name: string; sessions: number }>();
  for (const r of (metrics ?? []) as unknown as Array<{ site_id: string | null; metric: string; value: number; network_sites: { slug: string; name: string } | null }>) {
    if (!r.site_id) continue;
    const b = sessionsBySite.get(r.site_id) ?? { site_id: r.site_id, name: r.network_sites?.name ?? '—', sessions: 0 };
    // Prefer ga4_sessions when available; otherwise count gsc_clicks as a weaker proxy.
    if (r.metric === 'ga4_sessions') b.sessions += Number(r.value);
    else if (r.metric === 'gsc_clicks' && b.sessions === 0) b.sessions += Number(r.value);
    sessionsBySite.set(r.site_id, b);
  }
  const revBySite = new Map<string, number>();
  for (const r of (revs ?? []) as Array<{ site_id: string | null; amount_minor: number; currency: string }>) {
    if (!r.site_id) continue;
    // Only aggregate GBP for the threshold check; non-GBP would require FX.
    if (r.currency === 'GBP') revBySite.set(r.site_id, (revBySite.get(r.site_id) ?? 0) + r.amount_minor);
  }
  const findings: OpportunityDraft[] = [];
  for (const b of sessionsBySite.values()) {
    const rev = revBySite.get(b.site_id) ?? 0;
    if (b.sessions >= 10000 && rev < 1000) {
      findings.push({
        kind: 'revenue_gap_vs_traffic',
        severity: 'high',
        title: `${b.name}: ${Math.round(b.sessions).toLocaleString('en-GB')} sessions, £${(rev / 100).toFixed(2)} revenue in 28d`,
        rationale: `Traffic is substantial but revenue is near zero. Candidate for new placement or affiliate wiring.`,
        evidence: { site_id: b.site_id, sessions_28d: Math.round(b.sessions), revenue_gbp_minor: rev },
        dedupe_key: `rev_gap:${b.site_id}:${since28}`,
        site_id: b.site_id,
      });
    }
  }
  return findings;
}

export async function scanOfferGaps(sb: SupabaseClient): Promise<OpportunityDraft[]> {
  const { data, error } = await sb.from('network_sponsorships')
    .select('id, partner_id, title, status, network_partners(display_name)')
    .in('status', ['active', 'accepted']);
  if (error) throw new Error(`[opps] offer gap: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{ id: string; partner_id: string; title: string; status: string; network_partners: { display_name: string } | null }>;
  if (rows.length === 0) return [];
  const { data: delivs, error: dErr } = await sb.from('network_sponsorship_deliverables')
    .select('sponsorship_id')
    .in('sponsorship_id', rows.map((r) => r.id));
  if (dErr) throw new Error(`[opps] offer gap deliverables: ${dErr.message}`);
  const hasDeliv = new Set(((delivs ?? []) as Array<{ sponsorship_id: string }>).map((d) => d.sponsorship_id));
  return rows
    .filter((r) => !hasDeliv.has(r.id))
    .map((r) => ({
      kind: 'offer_gap',
      severity: 'normal' as const,
      title: `${r.network_partners?.display_name ?? 'partner'}: deal "${r.title}" has 0 deliverables`,
      rationale: `Sponsorship is ${r.status} but no deliverables defined. Define scope so the partner knows what to expect.`,
      evidence: { sponsorship_id: r.id, status: r.status },
      dedupe_key: `offer_gap:${r.id}`,
      partner_id: r.partner_id,
      sponsorship_id: r.id,
    }));
}

export async function runOpportunityScan(sb: SupabaseClient): Promise<{ inserted: number; skipped: number; findings: OpportunityDraft[] }> {
  const findings = (await Promise.all([
    scanRenewalsDue(sb),
    scanUnderperformingSources(sb),
    scanAffiliateOptimisation(sb),
    scanRevenueGapVsTraffic(sb),
    scanOfferGaps(sb),
  ])).flat();

  let inserted = 0;
  let skipped = 0;
  for (const f of findings) {
    const { error } = await sb.from('network_partner_opportunities').insert({
      partner_id: f.partner_id ?? null,
      site_id: f.site_id ?? null,
      sponsorship_id: f.sponsorship_id ?? null,
      source_id: f.source_id ?? null,
      kind: f.kind,
      severity: f.severity,
      status: 'open',
      title: f.title,
      rationale: f.rationale,
      evidence: f.evidence,
      dedupe_key: f.dedupe_key,
    });
    if (error) {
      if (error.code === '23505') { skipped += 1; continue; }
      throw new Error(`[opps] insert: ${error.message}`);
    }
    inserted += 1;
  }
  return { inserted, skipped, findings };
}

export interface OpportunityRow {
  id: string;
  kind: string;
  severity: string;
  status: string;
  title: string;
  rationale: string;
  evidence: Record<string, unknown>;
  partner_id: string | null;
  site_id: string | null;
  sponsorship_id: string | null;
  source_id: string | null;
  task_id: string | null;
  created_at: string;
  resolved_at: string | null;
  dismissed_at: string | null;
}

export async function listOpenOpportunities(sb: SupabaseClient, limit = 100): Promise<OpportunityRow[]> {
  const { data, error } = await sb.from('network_partner_opportunities')
    .select('id, kind, severity, status, title, rationale, evidence, partner_id, site_id, sponsorship_id, source_id, task_id, created_at, resolved_at, dismissed_at')
    .eq('status', 'open')
    .order('severity', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[opps] list: ${error.message}`);
  return (data ?? []) as OpportunityRow[];
}
