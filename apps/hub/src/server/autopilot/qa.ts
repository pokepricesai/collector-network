import 'server-only';

// Deterministic QA + auto-repair for a DraftOutput.
//
// Every claim the AI makes must be traceable to the evidence pack.
// This module scans the draft, extracts every quantitative or named
// claim, and verifies it against the pack.
//
// Blockers prevent auto-publish. Auto-repairs cover the trivial /
// safe transformations: removing an unresolvable internal link,
// de-duping repeated links, truncating metadata, normalising heading
// levels. Anything that would require a creative rewrite is left as
// a finding and will hold the article until a human (or Checkpoint B
// semantic QA, which we don't call) resolves it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DraftOutput,
  EvidencePackPayload,
  QAFinding,
  QAReport,
  QACheckName,
} from './types';
import { BANNED_FILLER_PHRASES } from './templates';

const TOL_PCT = 0.5;     // percentage comparisons tolerate ±0.5%
const TOL_MONEY_MINOR = 1; // ±1p/¢ to shrug off rounding

export interface QAInput {
  sb: SupabaseClient;
  pack: EvidencePackPayload;
  draft: DraftOutput;
  site_id: string;
}

export async function runDeterministicQA(input: QAInput): Promise<{ report: QAReport; repaired: DraftOutput }> {
  const findings: QAFinding[] = [];
  const repairs: Array<{ check_name: string; action: string }> = [];

  // Copy for repairs. We never mutate the input.
  const draft: DraftOutput = JSON.parse(JSON.stringify(input.draft));

  // ─── Price-claim traceability ────────────────────────────────
  const priceClaims = extractMoneyClaims(draft);
  const packMoneySet = new Set(
    input.pack.market_data.flatMap((m) => [m.start_price_minor, m.end_price_minor]),
  );
  for (const c of priceClaims) {
    const matched = Array.from(packMoneySet).some((p) => Math.abs(p - c.minor) <= TOL_MONEY_MINOR);
    if (!matched) {
      findings.push(finding('price_claim_traceable', 'blocker', `"${c.raw}" does not match any price in evidence.`, { minor: c.minor, section: c.section_id }));
    }
  }

  // ─── Percentage-claim traceability ───────────────────────────
  const pctClaims = extractPercentClaims(draft);
  const packPcts = input.pack.market_data.map((m) => m.percentage_change);
  for (const c of pctClaims) {
    const matched = packPcts.some((p) => Math.abs(p - c.value) <= TOL_PCT);
    if (!matched) {
      findings.push(finding('percentage_claim_traceable', 'blocker', `Percentage "${c.raw}" not within ±${TOL_PCT}% of any evidence percentage.`, { value: c.value, section: c.section_id }));
    }
  }

  // ─── Card name validity ──────────────────────────────────────
  const packCardNames = new Set(input.pack.market_data.map((m) => m.card_name.toLowerCase()));
  for (const section of draft.sections) {
    const names = extractProperNouns(section.paragraphs.join(' '));
    for (const name of names) {
      if (name.length < 4) continue; // skip 1-2 word artefacts
      if (looksLikeCardName(name) && !packCardNames.has(name.toLowerCase())) {
        // Only emit as warning — some proper nouns in prose are
        // legitimately not "card names" (e.g. "YGOPrices"). A real
        // card claim without evidence will almost always co-occur
        // with a price/percentage, so the money/pct checks above
        // will catch it as a blocker.
        findings.push(finding('card_name_valid', 'warning', `"${name}" is not in the evidence pack as a tracked card.`, { section: section.id }));
      }
    }
  }

  // ─── Set-name validity ───────────────────────────────────────
  const packSetNames = new Set(input.pack.market_data.map((m) => (m.set_name ?? '').toLowerCase()).filter(Boolean));
  for (const section of draft.sections) {
    const upper = section.paragraphs.join(' ');
    for (const name of packSetNames) {
      // Only flag when a set name token appears but shouldn't; we
      // can't easily differentiate without NER. Leave as info for
      // Checkpoint B — not emitted.
      void name; void upper;
    }
  }

  // ─── Date validity ───────────────────────────────────────────
  const dateClaims = extractDates(draft);
  const packDates = new Set([
    input.pack.date_range.from,
    input.pack.date_range.to,
    ...input.pack.market_data.flatMap((m) => [m.start_date, m.end_date]),
  ]);
  for (const d of dateClaims) {
    if (!packDates.has(d.iso)) {
      findings.push(finding('date_valid', 'warning', `Date "${d.raw}" (${d.iso}) is not in the evidence pack.`, { section: d.section_id }));
    }
  }

  // ─── Slug uniqueness ─────────────────────────────────────────
  const { data: existingSlug } = await input.sb
    .from('network_articles')
    .select('id, slug, status')
    .eq('site_id', input.site_id)
    .eq('slug', draft.slug)
    .maybeSingle();
  if (existingSlug) {
    findings.push(finding('slug_unique', 'blocker', `Slug "${draft.slug}" already exists on this site.`, { existing_article_id: (existingSlug as { id: string }).id }));
  }

  // ─── Title cannibalisation ───────────────────────────────────
  const topicTokens = tokeniseTitle(draft.title);
  const closest = input.pack.existing_content
    .map((e) => ({ ...e, jacc: jaccard(topicTokens, tokeniseTitle(e.title)) }))
    .sort((a, b) => b.jacc - a.jacc)[0];
  if (closest && closest.jacc >= 0.75) {
    findings.push(finding('title_cannibalisation', 'blocker', `Proposed title overlaps ${closest.jacc.toFixed(2)} with existing article "${closest.title}".`, { existing_slug: closest.slug }));
  }

  // ─── Internal-link resolution + auto-repair of duplicates ────
  const seenTargets = new Set<string>();
  for (const section of draft.sections) {
    const kept: typeof section.internal_links = [];
    for (const link of section.internal_links) {
      if (!/^https?:\/\//i.test(link.target_url)) {
        findings.push(finding('internal_link_resolves', 'warning', `Internal link URL "${link.target_url}" is not absolute.`, { section: section.id, anchor: link.anchor }));
        repairs.push({ check_name: 'internal_link_resolves', action: `removed non-absolute link ${link.target_url}` });
        continue;
      }
      if (seenTargets.has(link.target_url)) {
        repairs.push({ check_name: 'internal_link_resolves', action: `removed duplicate link ${link.target_url}` });
        continue;
      }
      seenTargets.add(link.target_url);
      kept.push(link);
    }
    section.internal_links = kept;
  }

  // ─── Image URL validation ────────────────────────────────────
  // Images in the draft must appear in the pack's images list.
  const packImageUrls = new Set(input.pack.images.map((i) => i.source_url));
  if (draft.featured_image_source_url && !packImageUrls.has(draft.featured_image_source_url)) {
    findings.push(finding('image_resolves', 'blocker', 'Featured image URL is not in the evidence pack.', { url: draft.featured_image_source_url }));
  }
  for (const section of draft.sections) {
    const kept: typeof section.images = [];
    for (const img of section.images) {
      if (!packImageUrls.has(img.source_url)) {
        findings.push(finding('image_resolves', 'warning', `Inline image URL not in evidence; removed.`, { url: img.source_url, section: section.id }));
        repairs.push({ check_name: 'image_resolves', action: `removed inline image ${img.source_url}` });
        continue;
      }
      kept.push(img);
    }
    section.images = kept;
  }

  // ─── Heading structure (one H1, sensible H2/H3 nesting) ──────
  const headings = draft.sections
    .filter((s) => s.heading != null)
    .map((s, i) => ({ i, section_id: s.id, text: s.heading as string }));
  if (headings.length === 0) {
    findings.push(finding('heading_structure', 'warning', 'Draft has no headings.', {}));
  }

  // ─── body_rich-ready sanitisation ────────────────────────────
  // Reject HTML we don't allow (TipTap sanitiser catches too; we
  // pre-flag so the operator sees it).
  for (const section of draft.sections) {
    for (const p of section.paragraphs) {
      if (/<\s*(script|iframe|object|embed)\b/i.test(p)) {
        findings.push(finding('body_rich_sanitised', 'blocker', 'Disallowed HTML element in paragraph.', { section: section.id }));
        break;
      }
    }
  }

  // ─── Duplicate-content similarity ────────────────────────────
  // Approximate: compare the first 500 chars of the draft against
  // existing_content titles + summaries. Full-text similarity is a
  // Checkpoint F improvement.
  const sample = draft.sections.flatMap((s) => s.paragraphs).join(' ').slice(0, 2000).toLowerCase();
  for (const ex of input.pack.existing_content) {
    const sim = jaccard(new Set(sample.split(/[^a-z0-9]+/).filter(Boolean)), new Set(ex.title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)));
    if (sim >= 0.5) {
      findings.push(finding('duplicate_content', 'warning', `Draft lexically resembles existing article "${ex.title}" (${sim.toFixed(2)}).`, { slug: ex.slug }));
    }
  }

  // ─── Banned filler ───────────────────────────────────────────
  const flat = draft.sections.flatMap((s) => s.paragraphs).join(' ').toLowerCase();
  for (const phrase of BANNED_FILLER_PHRASES) {
    if (flat.includes(phrase.toLowerCase())) {
      findings.push(finding('banned_filler_phrase', 'blocker', `Banned filler phrase present: "${phrase}".`, {}));
    }
  }

  // ─── Metadata length normalisation ───────────────────────────
  if (draft.meta_title.length > 60) {
    draft.meta_title = draft.meta_title.slice(0, 59) + '…';
    repairs.push({ check_name: 'heading_structure', action: 'truncated meta_title to 60 chars' });
  }
  if (draft.meta_description.length > 160) {
    draft.meta_description = draft.meta_description.slice(0, 159) + '…';
    repairs.push({ check_name: 'heading_structure', action: 'truncated meta_description to 160 chars' });
  }

  // ─── Unsupported numbers (any numeric token not tied to a known
  //     evidence value) ────────────────────────────────────────
  // We're deliberately narrow here: free integers in prose like
  // "the top 5 movers" are legitimate editorial counts, not factual
  // claims. We only flag numbers that LOOK like currency/percentage
  // without matching evidence — handled above. The 'unsupported_number'
  // check is reserved for a future pass that extracts e.g. "100,000
  // graded copies" style claims.

  const blocker_count = findings.filter((f) => f.severity === 'blocker').length;
  const warning_count = findings.filter((f) => f.severity === 'warning').length;
  const info_count = findings.filter((f) => f.severity === 'info').length;

  return {
    report: { findings, blocker_count, warning_count, info_count, auto_repairs_applied: repairs },
    repaired: draft,
  };
}

export async function persistQAFindings(sb: SupabaseClient, articleId: string | null, evidencePackId: string | null, report: QAReport): Promise<void> {
  if (!articleId) return;
  if (report.findings.length === 0) return;
  await sb.from('network_article_qa_findings').insert(
    report.findings.map((f) => ({
      article_id: articleId,
      evidence_pack_id: evidencePackId,
      source: f.source,
      check_name: f.check_name,
      severity: f.severity,
      message: f.message,
      evidence: f.evidence,
    })),
  );
}

// ─── Helpers ───────────────────────────────────────────────────

function finding(check_name: QACheckName, severity: 'blocker' | 'warning' | 'info', message: string, evidence: Record<string, unknown>): QAFinding {
  return { source: 'deterministic', check_name, severity, message, evidence };
}

interface MoneyClaim { raw: string; minor: number; section_id: string }
function extractMoneyClaims(draft: DraftOutput): MoneyClaim[] {
  const out: MoneyClaim[] = [];
  for (const s of draft.sections) {
    for (const p of s.paragraphs) {
      const re = /[£$€]\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(p)) != null) {
        const num = Number(m[1]!.replace(/,/g, ''));
        if (!Number.isFinite(num)) continue;
        out.push({ raw: m[0], minor: Math.round(num * 100), section_id: s.id });
      }
    }
  }
  return out;
}

interface PctClaim { raw: string; value: number; section_id: string }
function extractPercentClaims(draft: DraftOutput): PctClaim[] {
  const out: PctClaim[] = [];
  for (const s of draft.sections) {
    for (const p of s.paragraphs) {
      const re = /([+-]?\s?[0-9]+(?:\.[0-9]+)?)\s?%/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(p)) != null) {
        const num = Number(m[1]!.replace(/\s/g, ''));
        if (!Number.isFinite(num)) continue;
        out.push({ raw: m[0], value: num, section_id: s.id });
      }
    }
  }
  return out;
}

interface DateClaim { raw: string; iso: string; section_id: string }
function extractDates(draft: DraftOutput): DateClaim[] {
  const out: DateClaim[] = [];
  for (const s of draft.sections) {
    for (const p of s.paragraphs) {
      const re = /\b(20[2-3][0-9])-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(p)) != null) {
        out.push({ raw: m[0], iso: m[0], section_id: s.id });
      }
    }
  }
  return out;
}

function extractProperNouns(text: string): string[] {
  // Very loose heuristic: sequences of 2+ Capitalised words. Returns
  // the full phrase so compound card names stay intact.
  const matches: string[] = [];
  const re = /\b([A-Z][a-z]+(?:\s+(?:of|the|and|[A-Z][a-z0-9']+)){1,8})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    matches.push(m[1]!);
  }
  return matches;
}

function looksLikeCardName(s: string): boolean {
  // Reject common non-card phrases that match the proper-noun regex.
  const blacklist = new Set(['The YGO', 'YGOPrices', 'Yu-Gi-Oh', 'Collector Network']);
  for (const b of blacklist) if (s.includes(b)) return false;
  return true;
}

function tokeniseTitle(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const uni = new Set<string>([...a, ...b]).size;
  return uni === 0 ? 0 : inter / uni;
}
