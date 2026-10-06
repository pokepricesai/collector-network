import 'server-only';

// Monthly deterministic observations grounded in real metrics.
// Every statement is produced by a rule with a numeric threshold
// against production data — no AI, no fabrication. If a rule's
// pre-conditions aren't met the observation simply isn't emitted.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  monthlyRevenueByCurrency,
  revenueBySite,
  revenueBySource,
  revenuePerThousandUsers,
  type ChartRange,
} from './charts';

export type ObservationTone = 'positive' | 'negative' | 'neutral' | 'warning';

export interface Observation {
  id: string;                    // deterministic id for keying
  tone: ObservationTone;
  headline: string;              // plain-English, no filler
  evidence: string;              // one sentence tying the headline to numbers
  metric_scope: 'revenue' | 'traffic' | 'efficiency' | 'reversal' | 'ageing' | 'concentration';
}

function currencySymbol(ccy: string): string {
  return ccy === 'GBP' ? '£' : ccy === 'USD' ? '$' : ccy === 'EUR' ? '€' : '';
}
function fmtMoney(minor: number, ccy: string): string {
  const n = Math.abs(minor) / 100;
  return `${currencySymbol(ccy)}${n.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
}
function pct(delta: number, base: number): number {
  if (base === 0) return 0;
  return (delta / base) * 100;
}
function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  if (!y || !m) return ym;
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

export async function monthlyObservations(sb: SupabaseClient): Promise<Observation[]> {
  const range: ChartRange = '12m';
  const [monthly, siteSplit, sourceSplit, rpku] = await Promise.all([
    monthlyRevenueByCurrency(sb, range),
    revenueBySite(sb, range),
    revenueBySource(sb, range),
    revenuePerThousandUsers(sb, range),
  ]);

  const observations: Observation[] = [];
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const prevDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevMonth = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const twoAgoDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  const twoAgoMonth = `${twoAgoDate.getUTCFullYear()}-${String(twoAgoDate.getUTCMonth() + 1).padStart(2, '0')}`;

  // ─ Revenue MoM, per currency ────────────────────────────────
  //
  // Affiliate commission has significant approval lag (typically
  // 30-45 days before an Action transitions PENDING → APPROVED). A
  // month that still has a lot of pending volume cannot be meaningfully
  // compared against a fully-matured prior month on confirmed-only.
  //
  // Maturity rule: a month is "mature" iff its pending share of
  // attributed commission (confirmed + pending) is below 15%. Only
  // emit a confirmed MoM headline when BOTH months being compared
  // are mature. Otherwise emit attribution-based observations that
  // describe the actual commercial state ("September currently has
  // £X attributed commission, of which £Y remains pending").
  const MATURITY_PENDING_SHARE = 0.15;
  const byMonthCcy = new Map<string, { confirmed: number; pending: number; reversed: number }>();
  for (const m of monthly) {
    byMonthCcy.set(`${m.bucket}:${m.currency}`, {
      confirmed: m.confirmed_minor,
      pending: m.pending_minor,
      reversed: m.reversed_minor,
    });
  }
  const isMature = (b: { confirmed: number; pending: number } | undefined): boolean => {
    if (!b) return false;
    const attributed = b.confirmed + b.pending;
    if (attributed === 0) return false;
    return (b.pending / attributed) < MATURITY_PENDING_SHARE;
  };

  const currencies = Array.from(new Set(monthly.map((m) => m.currency)));
  for (const ccy of currencies) {
    const prev = byMonthCcy.get(`${prevMonth}:${ccy}`);
    const prior = byMonthCcy.get(`${twoAgoMonth}:${ccy}`);
    if (!prev || !prior) continue;

    // Attribution snapshot for the recent month — always safe to emit.
    const prevAttributed = prev.confirmed + prev.pending;
    if (prevAttributed > 0) {
      const pendingShare = Math.round((prev.pending / prevAttributed) * 100);
      observations.push({
        id: `attributed-${ccy}-${prevMonth}`,
        tone: 'neutral',
        metric_scope: 'revenue',
        headline: `${monthLabel(prevMonth)} has ${fmtMoney(prevAttributed, ccy)} attributed commission (${pendingShare}% pending)`,
        evidence: isMature(prev)
          ? `${fmtMoney(prev.confirmed, ccy)} confirmed · ${fmtMoney(prev.pending, ccy)} pending. Month is substantially mature.`
          : `${fmtMoney(prev.confirmed, ccy)} confirmed · ${fmtMoney(prev.pending, ccy)} pending. The month has not fully matured — confirmed is not yet comparable with prior months.`,
      });
    }

    // Confirmed MoM — only when BOTH months are mature.
    if (!isMature(prev) || !isMature(prior)) continue;
    if (prior.confirmed === 0) continue;
    const d = pct(prev.confirmed - prior.confirmed, prior.confirmed);
    if (Math.abs(d) < 10) continue;
    observations.push({
      id: `rev-mom-${ccy}`,
      tone: d > 0 ? 'positive' : 'negative',
      metric_scope: 'revenue',
      headline: `${ccy} confirmed commission ${d > 0 ? 'rose' : 'fell'} ${fmtPct(d)} month-on-month`,
      evidence: `${monthLabel(prevMonth)} confirmed ${fmtMoney(prev.confirmed, ccy)} vs ${monthLabel(twoAgoMonth)} ${fmtMoney(prior.confirmed, ccy)}. Both months are substantially mature.`,
    });
  }

  // ─ Reversal rate change ──────────────────────────────────────
  for (const ccy of currencies) {
    const prev = byMonthCcy.get(`${prevMonth}:${ccy}`);
    const prior = byMonthCcy.get(`${twoAgoMonth}:${ccy}`);
    if (!prev || !prior) continue;
    const prevRev = Math.abs(prev.reversed);
    const priorRev = Math.abs(prior.reversed);
    const prevTotal = prev.confirmed + prev.pending + prevRev;
    const priorTotal = prior.confirmed + prior.pending + priorRev;
    if (prevTotal === 0 || priorTotal === 0) continue;
    const prevRate = prevRev / prevTotal;
    const priorRate = priorRev / priorTotal;
    if (prevRate < 0.05 && priorRate < 0.05) continue;
    const delta = (prevRate - priorRate) * 100;
    if (Math.abs(delta) < 2) continue;
    observations.push({
      id: `reversal-rate-${ccy}`,
      tone: delta > 0 ? 'warning' : 'positive',
      metric_scope: 'reversal',
      headline: `${ccy} reversal rate ${delta > 0 ? 'rose' : 'fell'} to ${(prevRate * 100).toFixed(1)}% in ${monthLabel(prevMonth)}`,
      evidence: `${fmtMoney(prevRev, ccy)} reversed out of ${fmtMoney(prevTotal, ccy)} total; ${monthLabel(twoAgoMonth)} rate was ${(priorRate * 100).toFixed(1)}%.`,
    });
  }

  // ─ Revenue per 1k users (efficiency) ─────────────────────────
  const prevRpku = rpku.find((p) => p.bucket === prevMonth);
  const priorRpku = rpku.find((p) => p.bucket === twoAgoMonth);
  if (prevRpku && priorRpku && prevRpku.users > 0 && priorRpku.users > 0) {
    for (const ccy of currencies) {
      const prevVal = prevRpku.rpku_minor_by_currency[ccy] ?? 0;
      const priorVal = priorRpku.rpku_minor_by_currency[ccy] ?? 0;
      if (prevVal === 0 || priorVal === 0) continue;
      const d = pct(prevVal - priorVal, priorVal);
      if (Math.abs(d) < 10) continue;
      observations.push({
        id: `rpku-${ccy}`,
        tone: d > 0 ? 'positive' : 'negative',
        metric_scope: 'efficiency',
        headline: `${ccy} revenue per 1,000 users ${d > 0 ? 'improved' : 'worsened'} ${fmtPct(d)} MoM`,
        evidence: `${monthLabel(prevMonth)} ${fmtMoney(prevVal, ccy)} per 1k vs ${monthLabel(twoAgoMonth)} ${fmtMoney(priorVal, ccy)}; monthly users ${priorRpku.users.toLocaleString()} → ${prevRpku.users.toLocaleString()}.`,
      });
    }
  }

  // ─ Dominant source concentration ─────────────────────────────
  const sourceTotals = new Map<string, { source: string; minor: number }>();
  for (const row of sourceSplit) {
    const existing = sourceTotals.get(row.currency) ?? { source: '', minor: 0 };
    const contribution = row.confirmed_minor;
    if (contribution > existing.minor) {
      sourceTotals.set(row.currency, { source: row.source_name, minor: contribution });
    }
  }
  for (const [ccy, top] of sourceTotals) {
    const grandTotal = sourceSplit
      .filter((s) => s.currency === ccy)
      .reduce((acc, s) => acc + s.confirmed_minor, 0);
    if (grandTotal === 0) continue;
    const share = (top.minor / grandTotal) * 100;
    if (share < 60) continue;
    observations.push({
      id: `src-concentration-${ccy}`,
      tone: 'neutral',
      metric_scope: 'concentration',
      headline: `${top.source} generated ${share.toFixed(0)}% of ${ccy} confirmed revenue (12m)`,
      evidence: `${fmtMoney(top.minor, ccy)} out of ${fmtMoney(grandTotal, ccy)}.`,
    });
  }

  // ─ Site attribution note ─────────────────────────────────────
  //
  // Historical EPN Actions carry no reliable site-level attribution
  // (SubId1 was not consistently tagged across outbound links). The
  // dashboard groups unattributable rows as "Site not attributable"
  // — not as a specific site that is coincidentally dominant. This
  // observation surfaces the fact as context, NOT as a warning.
  for (const ccy of currencies) {
    const perSite = siteSplit.filter((s) => s.currency === ccy);
    if (perSite.length === 0) continue;
    const grandTotal = perSite.reduce((acc, s) => acc + s.confirmed_minor + s.pending_minor, 0);
    const unattributable = perSite
      .filter((s) => s.site_slug === 'unmapped' || s.site_slug === 'site-not-attributable')
      .reduce((acc, s) => acc + s.confirmed_minor + s.pending_minor, 0);
    if (grandTotal === 0 || unattributable === 0) continue;
    const share = (unattributable / grandTotal) * 100;
    if (share < 50) continue;
    observations.push({
      id: `attribution-${ccy}`,
      tone: 'neutral',
      metric_scope: 'concentration',
      headline: `Historical ${ccy} EPN Actions cannot be reliably attributed to an individual Collector Network site`,
      evidence: `${share.toFixed(0)}% of attributed commission rolls up as "Site not attributable" — SubId1 coverage on outbound links was partial and mixed, so historical rows cannot be assigned to a specific site after the fact. Future outbound links will tag SubId1 consistently and attribution improves from that point forward only.`,
    });
  }

  // ─ Current-month-so-far pacing (only if we're mid-month) ────
  //
  // Pace against ATTRIBUTED (confirmed + pending), not confirmed-only,
  // because approval lag makes confirmed pacing meaningless in the
  // first half of each month.
  const dayOfMonth = now.getUTCDate();
  if (dayOfMonth > 7) {
    for (const ccy of currencies) {
      const curr = byMonthCcy.get(`${currentMonth}:${ccy}`);
      const prev = byMonthCcy.get(`${prevMonth}:${ccy}`);
      if (!curr || !prev) continue;
      const currAttrib = curr.confirmed + curr.pending;
      const prevAttrib = prev.confirmed + prev.pending;
      if (prevAttrib === 0) continue;
      const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();
      const paced = (currAttrib / dayOfMonth) * daysInMonth;
      const d = pct(paced - prevAttrib, prevAttrib);
      if (Math.abs(d) < 15) continue;
      observations.push({
        id: `pace-${ccy}`,
        tone: d > 0 ? 'positive' : 'warning',
        metric_scope: 'revenue',
        headline: `${monthLabel(currentMonth)} ${ccy} attributed commission pacing ${fmtPct(d)} vs ${monthLabel(prevMonth)}`,
        evidence: `${fmtMoney(currAttrib, ccy)} attributed through day ${dayOfMonth} (confirmed + pending); projected full-month ${fmtMoney(paced, ccy)} vs ${fmtMoney(prevAttrib, ccy)} last month.`,
      });
    }
  }

  return observations;
}
