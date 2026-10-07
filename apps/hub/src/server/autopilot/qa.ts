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
import { BANNED_FILLER_PHRASES, FORCED_COLLECTOR_ANGLE_PATTERNS, RARITY_VOCABULARY, SPECULATIVE_CLAIM_PATTERNS } from './templates';

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

  // ─── Card name validity (tightened in Checkpoint D) ──────────
  //
  // The previous implementation walked every capitalised multi-word
  // phrase in prose and warned when it wasn't a pack card. That
  // produced huge noise ("Creative Deck Profile", "Special Summons",
  // "Normal Traps" and so on were all flagged). It also wasn't
  // actionable because the writing model has latitude to use proper
  // nouns that aren't cards.
  //
  // New rule: only flag a phrase as an unsupported card identity when
  // the surrounding context explicitly treats it AS a card. We detect
  // three card-identity contexts:
  //
  //   1. The phrase is wrapped in straight double quotes.
  //   2. The phrase is immediately preceded by "the card" or
  //      "a card named" / "card called".
  //   3. The phrase is immediately adjacent (within 20 chars) to a
  //      currency or percentage claim.
  //
  // Even then, we only warn when the phrase doesn't appear in the
  // pack's market_data card list. Pack entity match uses lowercase.
  const packCardNames = new Set(input.pack.market_data.map((m) => m.card_name.toLowerCase()));
  const packCardNameTokens = Array.from(packCardNames); // for substring assist
  const CARD_IDENTITY_PATTERNS: RegExp[] = [
    // "Card Name"
    /"([A-Z][A-Za-z0-9][A-Za-z0-9'\- ]{2,80})"/g,
    // the card Card Name  /  a card named Card Name
    /\b(?:the card|a card named|card called)\s+([A-Z][A-Za-z0-9'\-]+(?:\s+[A-Z0-9][A-Za-z0-9'\-]+){0,5})/g,
  ];
  for (const section of draft.sections) {
    const text = section.paragraphs.join(' ');
    const candidates: string[] = [];
    for (const re of CARD_IDENTITY_PATTERNS) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) != null) {
        const phrase = (m[1] ?? '').trim();
        if (phrase.length >= 4) candidates.push(phrase);
      }
    }
    // Phrases adjacent to a money/percentage claim (within 20 chars).
    const moneyPctRe = /[£$€]\s?[0-9][0-9,]*(?:\.[0-9]{1,2})?|[+-]?\s?[0-9]+(?:\.[0-9]+)?\s?%/g;
    const CAP_PHRASE = /\b([A-Z][A-Za-z0-9'\-]+(?:\s+[A-Z0-9][A-Za-z0-9'\-]+){1,5})\b/g;
    let mm: RegExpExecArray | null;
    while ((mm = moneyPctRe.exec(text)) != null) {
      const start = Math.max(0, mm.index - 40);
      const end   = Math.min(text.length, mm.index + mm[0].length + 40);
      const window = text.slice(start, end);
      let cp: RegExpExecArray | null;
      while ((cp = CAP_PHRASE.exec(window)) != null) {
        const phrase = cp[1]!.trim();
        if (phrase.length >= 4) candidates.push(phrase);
      }
    }

    for (const phrase of candidates) {
      const lc = phrase.toLowerCase();
      if (packCardNames.has(lc)) continue;
      // Partial substring match against pack cards (e.g. "Angelechy
      // Ashtra" should match "angelechy ashtra, ft. betb support [cdp]").
      if (packCardNameTokens.some((n) => n.includes(lc) || lc.includes(n))) continue;
      findings.push(finding('card_name_valid', 'warning', `"${phrase}" is used in a card-identity context but is not in the evidence pack as a tracked card.`, { section: section.id }));
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

  // ─── Em dash hard-ban (Checkpoint C) ─────────────────────────
  // No em dash character may appear anywhere in the article. We
  // scan every text-bearing field and auto-repair paragraph bodies
  // (headings, titles, meta also) by replacing an em dash with a
  // comma + space. The finding is kept even after auto-repair so
  // the operator sees that the model drafted em dashes in the
  // first place; the publish-ready gate uses the auto_repaired
  // flag below.
  {
    let totalEmDashes = 0;
    const emDashLocations: Array<{ field: string; raw: string }> = [];

    const scanAndRepairString = (field: string, s: string): string => {
      if (!s.includes('—')) return s;
      const matches = s.match(/—/g);
      if (matches) {
        totalEmDashes += matches.length;
        emDashLocations.push({ field, raw: s.length > 160 ? s.slice(0, 157) + '...' : s });
      }
      return repairEmDashes(s);
    };

    draft.title            = scanAndRepairString('title', draft.title);
    draft.meta_title       = scanAndRepairString('meta_title', draft.meta_title);
    draft.meta_description = scanAndRepairString('meta_description', draft.meta_description);
    for (const section of draft.sections) {
      if (section.heading != null) section.heading = scanAndRepairString(`section[${section.id}].heading`, section.heading);
      section.paragraphs = section.paragraphs.map((p, idx) => scanAndRepairString(`section[${section.id}].p[${idx}]`, p));
      for (const link of section.internal_links) link.anchor = scanAndRepairString(`section[${section.id}].link.anchor`, link.anchor);
      for (const img of section.images) img.alt_text = scanAndRepairString(`section[${section.id}].image.alt`, img.alt_text);
    }

    if (totalEmDashes > 0) {
      findings.push(finding(
        'no_em_dash',
        'blocker',
        `Em dash present in draft (${totalEmDashes} occurrence${totalEmDashes === 1 ? '' : 's'}). Auto-repaired to commas; keep the finding so operator can review context before publish.`,
        { count: totalEmDashes, locations: emDashLocations.slice(0, 10) },
      ));
      repairs.push({ check_name: 'no_em_dash', action: `replaced ${totalEmDashes} em dash(es) with commas` });
    }
  }

  // ─── Markdown leakage in paragraphs ──────────────────────────
  // Catches four shapes:
  //   1. ![alt](url)         — image markdown leaked into paragraph text
  //   2. [text](url)         — link markdown; should be in internal_links
  //   3. ### ... / ## ...    — markdown heading leaked into a paragraph
  //   4. **bold** / *italic* — inline emphasis markdown
  //
  // Only (1) is auto-repaired: we strip the markdown image from the
  // paragraph and (if the URL is in the evidence pack) push an image
  // node onto the section's images list. The other three leave the
  // paragraph as-is and emit a blocker because reconstructing TipTap
  // marks deterministically from arbitrary markdown is lossy; we'd
  // rather fail loudly and have the operator inspect.
  {
    const IMG_MD_RE  = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;
    const LINK_MD_RE = /(?<!\!)\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;
    const HEADING_MD_RE = /^\s{0,3}#{1,6}\s+/;
    const BOLD_RE = /\*\*[^*\n]+\*\*/;
    const ITAL_RE = /(^|[^*])\*[^*\n]+\*(?!\*)/;

    let imageLeaks = 0;
    let linkLeaks = 0;
    let headingLeaks = 0;
    let emphasisLeaks = 0;
    const imageLeakSamples: string[] = [];
    const linkLeakSamples: string[] = [];
    const headingLeakSamples: string[] = [];

    for (const section of draft.sections) {
      for (let i = 0; i < section.paragraphs.length; i++) {
        let p = section.paragraphs[i]!;

        // Image markdown: strip and promote URL to image list if
        // allowed by the pack.
        p = p.replace(IMG_MD_RE, (_match, alt: string, url: string) => {
          imageLeaks += 1;
          imageLeakSamples.push(url);
          if (packImageUrls.has(url)) {
            // Promote once; dedupe on URL.
            if (!section.images.some((img) => img.source_url === url)) {
              section.images.push({ source_url: url, alt_text: (alt ?? '').trim() });
              repairs.push({ check_name: 'markdown_image_leak', action: `promoted markdown image ${url} into section.images` });
            }
          } else {
            repairs.push({ check_name: 'markdown_image_leak', action: `stripped markdown image ${url} (not in evidence pack)` });
          }
          return '';
        }).replace(/\s{2,}/g, ' ').trim();

        if (LINK_MD_RE.test(p)) {
          // Reset regex because `.test` leaves lastIndex set.
          LINK_MD_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = LINK_MD_RE.exec(p)) != null) {
            linkLeaks += 1;
            linkLeakSamples.push(`${m[1]!} -> ${m[2]!}`);
          }
        }
        if (HEADING_MD_RE.test(p)) {
          headingLeaks += 1;
          headingLeakSamples.push(p.slice(0, 80));
        }
        if (BOLD_RE.test(p) || ITAL_RE.test(p)) {
          emphasisLeaks += 1;
        }

        section.paragraphs[i] = p;
      }
      // Drop any paragraphs that became empty after image stripping.
      section.paragraphs = section.paragraphs.filter((p) => p.trim().length > 0);
    }

    if (imageLeaks > 0) {
      findings.push(finding('markdown_image_leak', 'blocker', `Markdown image syntax leaked into paragraph text (${imageLeaks}). Auto-repaired by stripping/promoting; see samples.`, { count: imageLeaks, samples: imageLeakSamples.slice(0, 8) }));
    }
    if (linkLeaks > 0) {
      findings.push(finding('markdown_link_leak', 'blocker', `Markdown link syntax [text](url) found in paragraph text (${linkLeaks}). Model must emit links via internal_links, not inline markdown.`, { count: linkLeaks, samples: linkLeakSamples.slice(0, 8) }));
    }
    if (headingLeaks > 0) {
      findings.push(finding('heading_leakage', 'blocker', `Markdown heading syntax at start of paragraph (${headingLeaks}). Headings must be section.heading, not inline markdown.`, { count: headingLeaks, samples: headingLeakSamples }));
    }
    if (emphasisLeaks > 0) {
      findings.push(finding('markdown_link_leak', 'warning', `Inline **bold** or *italic* markdown present (${emphasisLeaks}). TipTap preview will render it as literal asterisks.`, { count: emphasisLeaks }));
    }
  }

  // ─── Speculative market claims ──────────────────────────────
  // A claim is speculative-unsupported when the pattern matches in
  // the article text AND no near-equivalent phrase appears in the
  // evidence pack's external_sources or market_data context.
  {
    const evidenceCorpus = buildEvidenceCorpus(input.pack);
    const paragraphCorpus = draft.sections.flatMap((s) => s.paragraphs).join('\n').toLowerCase();

    for (const pat of SPECULATIVE_CLAIM_PATTERNS) {
      const re = new RegExp(pat.pattern.source, pat.pattern.flags.includes('g') ? pat.pattern.flags : pat.pattern.flags + 'g');
      let m: RegExpExecArray | null;
      const hits: Array<{ phrase: string; context: string }> = [];
      while ((m = re.exec(paragraphCorpus)) != null) {
        const start = Math.max(0, m.index - 40);
        const end   = Math.min(paragraphCorpus.length, m.index + m[0].length + 40);
        hits.push({ phrase: m[0], context: paragraphCorpus.slice(start, end) });
        if (hits.length >= 5) break;
      }
      if (hits.length === 0) continue;

      // Check evidence corpus for any direct corroboration. The bar is
      // intentionally generous (substring match on the matched phrase
      // or on any of two to three tokens from it) because the writer
      // may paraphrase and we don't want a hard-blocker on surface
      // word choice when the evidence supports the gist.
      const supportedByEvidence = evidenceCorpus.includes(pat.label.toLowerCase())
        || evidenceCorpus.includes(hits[0]!.phrase.toLowerCase());
      if (!supportedByEvidence) {
        findings.push(finding(
          'speculative_claim',
          'blocker',
          `Speculative market claim "${pat.label}" present in draft but not supported by evidence pack.`,
          { pattern_id: pat.id, hits },
        ));
      }
    }
  }

  // ─── Forced collector angle (Checkpoint D) ───────────────────
  {
    const bodyFlat = draft.sections.flatMap((s) => s.paragraphs).join('\n');
    for (const pat of FORCED_COLLECTOR_ANGLE_PATTERNS) {
      const re = new RegExp(pat.pattern.source, pat.pattern.flags.includes('g') ? pat.pattern.flags : pat.pattern.flags + 'g');
      let m: RegExpExecArray | null;
      const hits: string[] = [];
      while ((m = re.exec(bodyFlat)) != null) {
        hits.push(m[0].slice(0, 80));
        if (hits.length >= 5) break;
      }
      if (hits.length > 0) {
        findings.push(finding(
          'forced_collector_angle',
          'warning',
          `Templated collector-angle phrasing detected: ${pat.label}.`,
          { pattern_id: pat.id, hits },
        ));
      }
    }

    // Density gate: no more than one "collectors" every 150 words.
    const words = bodyFlat.split(/\s+/).filter(Boolean);
    const collectorHits = (bodyFlat.match(/\bcollectors?\b/gi) ?? []).length;
    const allowed = Math.max(1, Math.ceil(words.length / 150));
    if (collectorHits > allowed) {
      findings.push(finding(
        'collector_density_high',
        'warning',
        `"collector(s)" appears ${collectorHits} time(s) across ${words.length} words (allowed ≤ ${allowed}). Reduce templated collector-centric phrasing.`,
        { word_count: words.length, collector_hits: collectorHits, allowed },
      ));
    }
  }

  // ─── Rarity claims ──────────────────────────────────────────
  // Every rarity string named in paragraph text must appear in
  // evidence_pack.market_data[].printing OR in an external source's
  // headline/summary/facts. Case-insensitive whole-phrase matching.
  {
    const rarityHaystack = (() => {
      const parts: string[] = [];
      for (const m of input.pack.market_data) {
        if (m.printing) parts.push(m.printing);
      }
      for (const src of input.pack.external_sources) {
        parts.push(src.headline);
        if (src.summary) parts.push(src.summary);
        for (const f of src.facts) parts.push(f);
      }
      return parts.join(' | ').toLowerCase();
    })();

    const paragraphText = draft.sections.flatMap((s) => s.paragraphs).join(' ');
    const titleText     = `${draft.title} ${draft.meta_title} ${draft.meta_description}`;
    const scanText      = `${titleText} ${paragraphText}`.toLowerCase();

    const unsupported: Array<{ rarity: string; where: string }> = [];
    for (const rarity of RARITY_VOCABULARY) {
      if (rarity === 'Common') continue;             // skip trivial token
      const needle = rarity.toLowerCase();
      // Word-ish match: require the phrase surrounded by non-alpha
      // boundaries so e.g. "Super Rare" doesn't match "superrare".
      const re = new RegExp(`(^|[^a-z])${escapeRe(needle)}([^a-z]|$)`);
      if (!re.test(scanText)) continue;
      if (rarityHaystack.includes(needle)) continue; // supported
      unsupported.push({ rarity, where: paragraphText.toLowerCase().includes(needle) ? 'body' : 'title/meta' });
    }

    if (unsupported.length > 0) {
      findings.push(finding(
        'rarity_claim_supported',
        'blocker',
        `Rarity claim(s) not supported by evidence pack: ${unsupported.map((u) => u.rarity).join(', ')}.`,
        { unsupported },
      ));
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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Deterministic em-dash repair. Guarantees zero U+2014 in the output.
// Chooses a punctuation substitute per occurrence based on context:
//
//   * Parenthetical aside: "X — Y — Z" (two em dashes close by, aside
//     between them) → wrap the aside in commas when it looks like a
//     non-restrictive clause, otherwise use parentheses.
//   * Pre-list em dash: "X — a, b, c" → colon.
//   * Sentence-break em dash: left side ends with a word, right side
//     starts with capital, and the segment on either side reads as an
//     independent clause → full stop + space + capital.
//   * Default: comma + space.
//
// After punctuation substitution we collapse the resulting runs of
// whitespace / repeated commas / orphan commas before terminal
// punctuation. We NEVER leave an em dash in place.
export function repairEmDashes(input: string): string {
  if (!input.includes('—')) return input;
  let out = input;

  // Parenthetical aside: `word — aside — word`. Replace both dashes
  // with commas (safe for restrictive and non-restrictive asides when
  // the aside is short).
  out = out.replace(/\s*—\s*([^—\n]{1,80}?)\s*—\s*/g, ', $1, ');

  // Pre-list em dash: a list of at least two comma-separated items on
  // the right side → use colon.
  out = out.replace(/\s*—\s*(?=[^.!?\n]{0,200}?[^,\n]+,\s*[^,\n]+)/g, ': ');

  // Sentence-break em dash: right side begins with a capital letter
  // after optional whitespace and the preceding char is a lower-case
  // letter → full stop + space.
  out = out.replace(/([a-z0-9])\s*—\s*(?=[A-Z])/g, '$1. ');

  // Default (any remaining em dash): comma + space.
  out = out.replace(/\s*—\s*/g, ', ');

  // Cleanups: no double commas, no space before punctuation, no stray
  // leading comma, collapse whitespace.
  out = out
    .replace(/,\s*,+/g, ',')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^\s*[,;:]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return out;
}

// Builds a lowercase corpus of every string in the evidence pack
// that the writer may legitimately draw a market/collector claim
// from. Used by the speculative-claim check to decide whether a
// speculative phrase is corroborated.
function buildEvidenceCorpus(pack: EvidencePackPayload): string {
  const parts: string[] = [];
  if (pack.topic.summary) parts.push(pack.topic.summary);
  parts.push(pack.methodology);
  parts.push(pack.article_angle.one_line);
  for (const m of pack.article_angle.must_cover) parts.push(m);
  for (const src of pack.external_sources) {
    parts.push(src.headline);
    if (src.summary) parts.push(src.summary);
    for (const f of src.facts) parts.push(f);
  }
  for (const m of pack.market_data) {
    parts.push(m.card_name);
    if (m.printing) parts.push(m.printing);
  }
  return parts.join(' | ').toLowerCase();
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
