import 'server-only';

// Model executor with REAL and FIXTURE modes.
//
// Checkpoint B uses FIXTURE mode exclusively. The REAL branch exists
// for shape/typing but intentionally throws if invoked — a REAL call
// requires explicit Luke approval and a reservation on the budget
// RPCs. We'd rather fail loudly than discover an accidental spend.
//
// Fixture output is deterministic given an (evidence pack, template)
// pair so the downstream QA pipeline is testable without touching
// Anthropic. The fixture draft is structurally identical to what a
// real draft would be (same JSON shape), so every QA check runs the
// same way.

import type { SupabaseClient } from '@supabase/supabase-js';
import { selectModel, type SelectedModel } from './models';
import type {
  DraftOutput,
  DraftSection,
  EvidencePackPayload,
  ExecutionMode,
  MarketObservation,
  ModelExecutionResult,
  TemplateSection,
} from './types';
import { getTemplate } from './templates';
import { parseDraftJson } from './output-parser';

export interface ExecuteParams {
  mode: ExecutionMode;
  pack: EvidencePackPayload;
}

export async function executeDraft(sb: SupabaseClient, params: ExecuteParams): Promise<ModelExecutionResult> {
  const sel = await selectModel(sb, 'default_draft');
  if ('ok' in sel) throw new Error(`Draft model unavailable: ${sel.reason}`);
  if (params.mode === 'real') {
    // Checkpoint B does not allow REAL calls. We throw rather than
    // route the function silently — the caller must explicitly flip
    // to fixture mode OR go through the (future) authorised-pay path.
    throw new Error('REAL model execution is not permitted in Checkpoint B. Preview-only.');
  }
  return executeFixture(sel, params.pack);
}

function executeFixture(model: SelectedModel, pack: EvidencePackPayload): ModelExecutionResult {
  const t0 = Date.now();
  const template = getTemplate(pack.topic.kind);
  const rawDraft = buildFixtureDraft(template.sections, pack);

  // Both FIXTURE and REAL paths go through the SAME parser so there
  // is no fixture-only shortcut. If the deterministic fixture ever
  // produces something that doesn't validate against the DraftOutput
  // schema, we fail loudly rather than silently diverging from what
  // the real path would do.
  const parsed = parseDraftJson(JSON.stringify(rawDraft));
  if (!parsed.ok) {
    throw new Error(`Fixture draft failed schema validation: ${parsed.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }

  // Representative token counts for the budget-preview display. We
  // don't reserve budget in fixture mode so these are display-only.
  const tokens = { input: 5000, output: 2500, cache_read: 0, cache_write: 1200 };

  return {
    mode: 'fixture',
    model: model.model,
    provider: model.provider,
    tokens,
    cost_usd: 0,
    draft: parsed.draft,
    latency_ms: Date.now() - t0,
  };
}

// ─── Fixture draft construction (deterministic) ────────────────
//
// The fixture is NOT a mock AI pretending to be creative. It mirrors
// evidence exactly — every number comes from the pack. This gives us
// a draft that will pass deterministic QA (because it only references
// evidence) and lets us exercise the body_rich → publish pipeline.
// It is NOT a stand-in for creative prose; the user is explicitly
// told "the first genuine AI-written draft requires the first paid
// model call".

function buildFixtureDraft(sections: TemplateSection[], pack: EvidencePackPayload): DraftOutput {
  const topMovers: MarketObservation[] = [...pack.market_data]
    .sort((a, b) => Math.abs(b.percentage_change) - Math.abs(a.percentage_change))
    .slice(0, 5);
  const headliner = topMovers[0] ?? null;

  const title = pack.topic.working_title;
  const slug = slugify(title);
  const metaTitle = truncate(`${title} | YGOPrices`, 60);
  const metaDescription = truncate(
    headliner
      ? `${headliner.card_name} led YGO price movement between ${pack.date_range.from} and ${pack.date_range.to}, moving ${headliner.percentage_change.toFixed(1)}%.`
      : `YGO market observations between ${pack.date_range.from} and ${pack.date_range.to}.`,
    160,
  );

  const featured = pack.images.find((i) => i.role_suggestion === 'featured') ?? pack.images[0] ?? null;

  const built: DraftSection[] = [];
  for (const section of sections) {
    built.push({
      id: section.id,
      heading: section.heading_level ? sectionHeading(section, pack) : null,
      heading_level: section.heading_level,
      paragraphs: sectionParagraphs(section, pack, topMovers, headliner),
      internal_links: section.evidence.includes('internal_links') ? pickLinks(section, pack) : [],
      images: section.id === 'top_movers' && featured
        ? [{ source_url: featured.source_url, alt_text: featured.alt_text }]
        : [],
    });
  }

  return {
    title,
    meta_title: metaTitle,
    meta_description: metaDescription,
    slug,
    featured_image_source_url: featured?.source_url ?? null,
    sections: built,
  };
}

function sectionHeading(section: TemplateSection, pack: EvidencePackPayload): string {
  switch (section.id) {
    case 'intro':         return pack.topic.working_title;
    case 'methodology':   return 'How we measured it';
    case 'top_movers':    return 'This week\'s biggest movers';
    case 'card_detail':   return 'Card breakdown';
    case 'context':       return 'What changed';
    case 'what_to_watch': return 'What to watch';
    case 'related':       return 'Related cards and sets';
    case 'close':         return 'Where this leaves collectors';
    case 'card_overview':   return pack.topic.working_title;
    case 'card_printings':  return 'Printings';
    case 'card_market':     return 'Market position';
    case 'card_movement':   return 'Recent movement';
    case 'collecting':      return 'Collecting considerations';
    case 'set_overview':    return pack.topic.working_title;
    case 'set_key_cards':   return 'Key cards';
    case 'set_market':      return 'Market observations';
    case 'set_watchlist':   return 'Collectors\' watchlist';
    case 'faq':             return 'Quick questions';
    default:                return section.title_hint;
  }
}

function sectionParagraphs(
  section: TemplateSection,
  pack: EvidencePackPayload,
  topMovers: MarketObservation[],
  headliner: MarketObservation | null,
): string[] {
  const paras: string[] = [];
  const extNewest = pack.external_sources[0] ?? null;
  switch (section.id) {
    case 'intro':
      if (headliner) {
        paras.push(
          `Between ${pack.date_range.from} and ${pack.date_range.to}, ${topMovers.length} Yu-Gi-Oh! cards tracked by YGOPrices showed noteworthy price movement.`,
        );
        paras.push(
          `${headliner.card_name} led the move, closing at ${formatMoney(headliner.end_price_minor, headliner.currency)} — a ${signed(headliner.percentage_change)}% shift from ${formatMoney(headliner.start_price_minor, headliner.currency)} at the start of the window.`,
        );
      } else if (extNewest) {
        paras.push(pack.article_angle.one_line);
        paras.push(`Reported by ${extNewest.publisher}${extNewest.published_at ? ` on ${extNewest.published_at.slice(0, 10)}` : ''}.`);
      } else {
        paras.push(pack.article_angle.one_line);
      }
      break;
    case 'methodology':
      paras.push(pack.methodology);
      break;
    case 'top_movers':
      if (topMovers.length > 0) {
        paras.push(
          `${topMovers.length} card${topMovers.length === 1 ? '' : 's'} crossed our movement threshold during the window. Each entry below is a single tracked printing.`,
        );
      }
      break;
    case 'card_detail':
      // Deterministic card-by-card summary — one paragraph per mover.
      for (const m of topMovers) {
        paras.push(
          `${m.card_name}${m.printing ? ` (${m.printing})` : ''}${m.set_name ? ` from ${m.set_name}` : ''} moved from ${formatMoney(m.start_price_minor, m.currency)} to ${formatMoney(m.end_price_minor, m.currency)} — a ${signed(m.percentage_change)}% change across ${m.observation_count} tracked observation${m.observation_count === 1 ? '' : 's'}.`,
        );
      }
      break;
    case 'context':
      if (pack.external_sources.length > 0) {
        for (const src of pack.external_sources.slice(0, 2)) {
          paras.push(
            `${src.publisher} (${src.source_tier}) ${src.published_at ? `on ${src.published_at.slice(0, 10)} ` : ''}headline: "${src.headline}".`,
          );
          if (src.summary) paras.push(src.summary);
        }
      } else {
        paras.push(
          `Movement of this scale usually reflects a shift in tournament relevance, a reprint announcement, or a supply constraint. The data here does not explain the "why" — it only quantifies what moved.`,
        );
      }
      break;
    case 'what_to_watch':
      paras.push(
        `Watch for the next few daily snapshots to confirm whether these moves consolidate or reverse. A single-day spike without follow-through is often noise, not a trend.`,
      );
      break;
    case 'related':
      // The fixture doesn't invent anything here; related content comes from the pack.
      if (pack.related_pages.length > 0) {
        paras.push(
          `Related cards and sets tracked by YGOPrices during this window include ${pack.related_pages.slice(0, 5).map((p) => p.title ?? p.url).join(', ')}.`,
        );
      }
      break;
    case 'close':
      paras.push(
        `Prices will refresh in the next daily sync. Return to the tracked card and set pages for the live view.`,
      );
      break;
    case 'card_overview':
    case 'set_overview':
      paras.push(pack.topic.summary ?? pack.topic.working_title);
      break;
    case 'card_printings':
      // Deterministic printing list from market_data.
      {
        const printings = Array.from(new Set(pack.market_data.map((m) => m.printing).filter(Boolean))) as string[];
        if (printings.length > 0) {
          paras.push(`Tracked printings: ${printings.join(', ')}.`);
        }
      }
      break;
    case 'card_market':
    case 'set_market':
      if (headliner) {
        paras.push(
          `Current tracked price range: ${formatMoney(Math.min(...pack.market_data.map((m) => m.end_price_minor)), headliner.currency)} to ${formatMoney(Math.max(...pack.market_data.map((m) => m.end_price_minor)), headliner.currency)}.`,
        );
      }
      break;
    case 'card_movement':
      for (const m of topMovers.slice(0, 2)) {
        paras.push(
          `${m.start_date} → ${m.end_date}: ${formatMoney(m.start_price_minor, m.currency)} to ${formatMoney(m.end_price_minor, m.currency)} (${signed(m.percentage_change)}%).`,
        );
      }
      break;
    case 'collecting':
      paras.push(`Printings vary in supply and condition. YGOPrices tracks each printing separately — pick the exact variant you intend to buy.`);
      break;
    case 'set_key_cards':
    case 'set_watchlist':
      for (const m of topMovers.slice(0, 5)) {
        paras.push(`${m.card_name}${m.printing ? ` (${m.printing})` : ''} — tracked at ${formatMoney(m.end_price_minor, m.currency)}.`);
      }
      break;
    case 'faq':
      paras.push(`YGOPrices pulls fresh observations daily. If a card isn't tracked, open a note on the card page.`);
      break;
    default:
      // For template sections we haven't tuned, emit a minimal placeholder.
      paras.push(`See the data above.`);
  }
  return paras.filter((p) => p && p.length > 0);
}

function pickLinks(_section: TemplateSection, pack: EvidencePackPayload): Array<{ anchor: string; target_url: string }> {
  // Deterministic selection: pick top 3 highest-priority link
  // candidates and form anchors from their suggested concepts.
  const picks = [...pack.internal_links]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);
  return picks.map((l) => ({
    anchor: l.anchor_concepts[0] ?? 'see also',
    target_url: l.target_url,
  }));
}

function formatMoney(minor: number, currency: string): string {
  const major = minor / 100;
  const sym = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
  return `${sym}${major.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signed(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}`;
}

function slugify(input: string): string {
  return input.toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}
