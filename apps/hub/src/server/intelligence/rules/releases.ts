import 'server-only';

// CN-05 Growth Intelligence · Release Readiness detector.
//
// Produces ONE intelligence item per impending release (<= 30d away)
// where the OS can detect a preparation gap. "Preparation gap" is
// resolved from signals we actually have:
//   * site_set_url is set → operator has already linked a page.
//     Readiness is treated as "linked" (no task emitted) unless the
//     set is <= 14d away AND the item has no implementation receipt
//     yet (then it's still worth confirming).
//   * site_set_url is NULL → no public page registered. One task.
//   * confirmation_status is 'rumoured' or 'cancelled' → skip.
//   * confirmation_status is 'announced_tbc' → emit as low-priority
//     content preparation signal (no exact date yet, but worth
//     tracking).
//
// Deliberately simple:
//   * One intel item per release (source_key = seo:release:<id>).
//     Dedup via upsert. The intel refresh engine will auto-resolve
//     when the release passes or the row is deleted.
//   * No scraping. No AI. The detection rule only reads records
//     the operator has curated.
//   * Scored moderately: impact grows as the release approaches;
//     confidence stays modest because the OS can't verify from this
//     side whether the operator considers the site "ready".

import type { IntelligenceRule, RuleContext, RuleOutput, RuleRunResult, SiteSlug } from '../types';
import type { TcgReleaseRow, Tcg } from '../../releases/types';
import { TCG_LABEL, daysUntilRelease, formatReleaseDate } from '../../releases/types';

function clamp(n: number, lo = 0, hi = 100): number { return Math.max(lo, Math.min(hi, Math.round(n))) }

export const releaseReadinessRule: IntelligenceRule = {
  id: 'content.release_readiness',
  description: 'Impending TCG releases within 90d where site preparation is not yet linked, plus pre-launch readiness checks within 14d. One item per release.',
  categoriesScanned: ['content'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const outputs: RuleOutput[] = [];
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    // Readiness window widened to 90 days per the brief:
    // "Support preparation well before a major release, not only
    // within 30 days." A quarter of visibility balances useful
    // lead time against inbox noise. Scoring and emission rules
    // below decay with distance so far-horizon items don't
    // outrank imminent ones.
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + 90);
    const horizonIso = horizon.toISOString().slice(0, 10);

    // Pull releases in the next 30 days + any TBC-but-announced
    // items. The query is intentionally narrow — we don't scan
    // the full calendar on every refresh.
    const { data, error } = await ctx.sb
      .from('network_tcg_releases')
      .select('id, tcg, site_slug, set_name, set_name_original, set_code, product_type, language, region, release_date, release_date_precision, prerelease_date, confirmation_status, source_url, site_set_url, source_verified_at, verification_mode')
      .in('confirmation_status', ['confirmed', 'announced_tbc', 'postponed'])
      .gte('release_date', todayIso)
      .lte('release_date', horizonIso)
      .limit(200);
    if (error) {
      // Non-fatal — the migration may not be applied yet. Return
      // zero outputs so the rest of the engine continues.
      return {
        outputs: [],
        diagnostics: [{
          scope: 'network',
          status: 'error',
          items_emitted: 0,
          reason: `releases table unreachable: ${error.message}`,
        }],
      };
    }

    const rows = (data ?? []) as unknown as TcgReleaseRow[];
    for (const r of rows) {
      const d = daysUntilRelease(r, today);
      if (d == null || d < 0) continue;

      // Emission bands tuned to keep the inbox useful:
      //   0–14d:  always emit (imminent — readiness check or missing page)
      //   15–60d: emit when unlinked (needs planning)
      //   61–90d: emit only when unlinked AND product_type suggests a
      //           flagship expansion (far-horizon awareness)
      // The 'postponed' status always emits regardless of band so the
      // operator sees the slip in context.
      const flagshipTypes = new Set(['expansion', 'premium']);
      if (r.confirmation_status !== 'postponed') {
        if (d > 14 && r.site_set_url) continue;
        if (d > 60 && !flagshipTypes.has(r.product_type)) continue;
      }

      // Score bands tuned conservatively.
      // Impact grows as release approaches (closer = higher impact).
      // Confidence modest because readiness is operator-judged.
      const impact = clamp(30 + Math.max(0, 60 - d * 2));
      const confidence = clamp(r.site_set_url ? 45 : 65);
      const urgency = clamp(50 + Math.max(0, 60 - d * 2));
      const effort = 40;

      const tcgLabel = TCG_LABEL[r.tcg as Tcg] ?? r.tcg;
      const langLabel = r.language === 'ja' ? ' (Japanese)' : r.language === 'other' ? ` (${r.region ?? 'regional'})` : '';
      const releaseLabel = formatReleaseDate(r);

      const title = `Release in ${d <= 7 ? `${d}d` : `${d}d`}: ${r.set_name}${langLabel} · ${tcgLabel}`;
      const summary = r.site_set_url
        ? `${tcgLabel} release ${releaseLabel}. Set page linked. Confirm readiness: card data, pricing, metadata.`
        : `${tcgLabel} release ${releaseLabel}. No public set page linked yet. Decide whether to prepare one before the release window closes.`;

      const recommended_action = r.site_set_url
        ? 'Investigate: visit the linked set page and confirm card data, pricing freshness, metadata, and internal links from relevant hub pages are ready for release traffic. If everything is already present, record NO_CHANGE with a note.'
        : 'Investigate: decide whether a set page / content coverage is warranted for this release. If yes, route through the OS Articles pipeline (idea → brief → draft) rather than creating a placeholder page. If the site is a smaller TCG (MTG/YGO/OnePiece/Lorcana) and we lack catalogue data, a short editorial article may be a better fit than a full set page.';

      outputs.push({
        source_type: 'release',
        source_id: r.id,
        source_key: `content:release_readiness:${r.id}`,
        site_id: null,              // network-level item — the detector doesn't know the site_id yet
        site_slug: r.site_slug as SiteSlug,
        category: 'content',
        type: 'release_readiness',
        signal_kind: 'opportunity',
        title,
        summary,
        recommended_action,
        evidence: {
          release_id: r.id,
          tcg: r.tcg, site_slug: r.site_slug,
          set_name: r.set_name,
          set_name_original: r.set_name_original,
          set_code: r.set_code,
          product_type: r.product_type,
          language: r.language,
          region: r.region,
          release_date: r.release_date,
          release_date_precision: r.release_date_precision,
          prerelease_date: r.prerelease_date,
          days_until_release: d,
          confirmation_status: r.confirmation_status,
          source_url: r.source_url,
          site_set_url: r.site_set_url,
          source_verified_at: r.source_verified_at,
          verification_mode: r.verification_mode,
          readiness_signal: r.site_set_url ? 'page_linked_confirm_data' : 'no_public_page',
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: {
          label: 'Qualitative — depends on release scale and site traffic',
          metric: 'clicks_per_month',
          low: 0,
          high: 0,
          rationale: 'A ready set page can capture release-week search spikes; the actual uplift depends on the release scale, the current site traffic level, and whether competing resources are already ranking. Not forecasted.',
        },
      });
    }

    return { outputs, diagnostics: [] };
  },
};
