// Slice F — deterministic Yu-Gi-Oh deck legality engine.
//
// Pure functions only. No DB, no network. The engine takes a fully-
// hydrated deck (rows + per-card gameplay metadata) and returns:
//
//   • counts per section
//   • per-card copy count across Main + Extra + Side
//   • an issues[] list scoped to a state:
//        - 'incomplete' (needs more cards but nothing forbidden)
//        - 'legal'      (meets every rule)
//        - 'illegal'    (breaks a hard rule — Forbidden, over-cap,
//                        Extra-in-Main, Main-in-Extra, oversize, etc.)
//
// "Incomplete" is a first-class state so a work-in-progress deck is
// never labelled as "illegal".

import {
  COPY_CAP_BY_STATUS,
  DECK_SIZE_RULES,
  EXTRA_DECK_FRAMES,
  type FnlStatus,
  type Section,
} from './deck-identity';

// ── Public shapes ──────────────────────────────────────────────

// The engine works with normalised inputs — the server hydrates
// these from ygo_deck_cards + tcg_cards before invoking.
export interface DeckCardInput {
  card_key: string;         // gameplay identity (normalised)
  card_name: string;        // display
  section: Section;
  quantity: number;
  fnlStatus: FnlStatus;     // pulled from gamedata.banlist.tcg
  frameType: string | null; // gamedata.frameType, lowercased
}

export type LegalityState = 'incomplete' | 'legal' | 'illegal';

export interface LegalityIssue {
  severity: 'error' | 'info';
  // Machine tag so tests can assert without coupling to copy.
  code:
    | 'main-below-min'
    | 'main-above-max'
    | 'extra-above-max'
    | 'side-above-max'
    | 'forbidden-card'
    | 'over-copy-cap'
    | 'extra-in-main-or-side'
    | 'non-extra-in-extra';
  message: string;
  // Card identity when the issue is card-scoped.
  card_key?: string;
  card_name?: string;
}

export interface LegalityCounts {
  main: number;
  extra: number;
  side: number;
  total: number;
}

export interface LegalityResult {
  state: LegalityState;
  counts: LegalityCounts;
  issues: LegalityIssue[];
  // Per-card totals across Main+Extra+Side, keyed by card_key. Handy
  // for the UI to render "3/3 of Ash Blossom" etc.
  perCardTotals: Map<string, {
    name: string;
    total: number;
    cap: number;
    fnlStatus: FnlStatus;
  }>;
}

// ── Public entry point ─────────────────────────────────────────

export function evaluateDeckLegality(rows: readonly DeckCardInput[]): LegalityResult {
  const counts = tallySectionCounts(rows);
  const issues: LegalityIssue[] = [];

  // ── Copy-cap check (F&L) across Main + Extra + Side ──────────
  const totals = tallyPerCardTotals(rows);
  for (const [card_key, info] of totals) {
    if (info.fnlStatus === 'forbidden' && info.total > 0) {
      issues.push({
        severity: 'error',
        code: 'forbidden-card',
        message: `${info.name} is Forbidden and cannot appear in any deck.`,
        card_key,
        card_name: info.name,
      });
    } else if (info.total > info.cap) {
      const capLabel = statusLabelFor(info.fnlStatus, info.cap);
      issues.push({
        severity: 'error',
        code: 'over-copy-cap',
        message:
          `${info.name} is ${capLabel} - max ${info.cap} across the whole deck; ` +
          `you have ${info.total}.`,
        card_key,
        card_name: info.name,
      });
    }
  }

  // ── Section-placement checks ─────────────────────────────────
  for (const r of rows) {
    const isExtra = EXTRA_DECK_FRAMES.has((r.frameType ?? '').toLowerCase());
    if (isExtra && r.section !== 'extra' && r.section !== 'side') {
      // Extra-Deck monsters can appear in Side (Side is section-
      // agnostic in the TCG); but Main is forbidden.
      issues.push({
        severity: 'error',
        code: 'extra-in-main-or-side',
        message: `${r.card_name} is an Extra-Deck monster and cannot go in the Main Deck.`,
        card_key: r.card_key,
        card_name: r.card_name,
      });
    }
    if (!isExtra && r.section === 'extra') {
      issues.push({
        severity: 'error',
        code: 'non-extra-in-extra',
        message: `${r.card_name} is not an Extra-Deck monster and cannot go in the Extra Deck.`,
        card_key: r.card_key,
        card_name: r.card_name,
      });
    }
  }

  // ── Section-size checks (Main min/max, Extra max, Side max) ──
  const mainMissing = DECK_SIZE_RULES.main.min - counts.main;
  if (counts.main > DECK_SIZE_RULES.main.max) {
    issues.push({
      severity: 'error',
      code: 'main-above-max',
      message: `Main Deck exceeds maximum by ${counts.main - DECK_SIZE_RULES.main.max} (max ${DECK_SIZE_RULES.main.max}).`,
    });
  } else if (mainMissing > 0) {
    issues.push({
      severity: 'info',
      code: 'main-below-min',
      message: `Main Deck needs ${mainMissing} more card${mainMissing === 1 ? '' : 's'} (min ${DECK_SIZE_RULES.main.min}).`,
    });
  }
  if (counts.extra > DECK_SIZE_RULES.extra.max) {
    issues.push({
      severity: 'error',
      code: 'extra-above-max',
      message: `Extra Deck exceeds maximum by ${counts.extra - DECK_SIZE_RULES.extra.max} (max ${DECK_SIZE_RULES.extra.max}).`,
    });
  }
  if (counts.side > DECK_SIZE_RULES.side.max) {
    issues.push({
      severity: 'error',
      code: 'side-above-max',
      message: `Side Deck exceeds maximum by ${counts.side - DECK_SIZE_RULES.side.max} (max ${DECK_SIZE_RULES.side.max}).`,
    });
  }

  const hasError = issues.some((i) => i.severity === 'error');
  const isComplete = counts.main >= DECK_SIZE_RULES.main.min;
  const state: LegalityState = hasError
    ? 'illegal'
    : isComplete
    ? 'legal'
    : 'incomplete';

  return { state, counts, issues, perCardTotals: totals };
}

function tallySectionCounts(rows: readonly DeckCardInput[]): LegalityCounts {
  let main = 0;
  let extra = 0;
  let side = 0;
  for (const r of rows) {
    if (r.section === 'main') main += r.quantity;
    else if (r.section === 'extra') extra += r.quantity;
    else if (r.section === 'side') side += r.quantity;
  }
  return { main, extra, side, total: main + extra + side };
}

function tallyPerCardTotals(rows: readonly DeckCardInput[]) {
  const out = new Map<string, {
    name: string;
    total: number;
    cap: number;
    fnlStatus: FnlStatus;
  }>();
  for (const r of rows) {
    const entry = out.get(r.card_key) ?? {
      name: r.card_name,
      total: 0,
      cap: COPY_CAP_BY_STATUS[r.fnlStatus],
      fnlStatus: r.fnlStatus,
    };
    entry.total += r.quantity;
    out.set(r.card_key, entry);
  }
  return out;
}

function statusLabelFor(status: FnlStatus, cap: number): string {
  if (status === 'limited') return 'Limited';
  if (status === 'semi-limited') return 'Semi-Limited';
  return `capped at ${cap}`;
}

// ── Placement validation (used by both UI + server writes) ────

export interface PlacementDecision {
  ok: boolean;
  reason?: string;
}

// True when adding `deltaQty` more copies of a card (already in the
// deck at `existingTotalAcrossSections`) into `section` would keep
// the deck within: section-max, per-card cap (F&L), and frame-type
// section eligibility.
export function validatePlacement(input: {
  section: Section;
  frameType: string | null | undefined;
  fnlStatus: FnlStatus;
  existingSectionCount: number;
  existingTotalAcrossSections: number; // count of THIS card across sections, pre-change
  deltaQty: number;                    // >0 = add, <0 = remove
}): PlacementDecision {
  const isExtra = EXTRA_DECK_FRAMES.has((input.frameType ?? '').toLowerCase());
  // Frame → section eligibility.
  if (isExtra && input.section === 'main') {
    return { ok: false, reason: 'Extra-Deck monsters cannot go in the Main Deck.' };
  }
  if (!isExtra && input.section === 'extra') {
    return {
      ok: false,
      reason: 'Only Fusion, Synchro, Xyz and Link monsters belong in the Extra Deck.',
    };
  }
  // Section-size max.
  const nextSection = input.existingSectionCount + input.deltaQty;
  const maxForSection =
    input.section === 'main'
      ? DECK_SIZE_RULES.main.max
      : input.section === 'extra'
      ? DECK_SIZE_RULES.extra.max
      : DECK_SIZE_RULES.side.max;
  if (nextSection > maxForSection) {
    return {
      ok: false,
      reason: `${sectionLabel(input.section)} Deck cannot hold more than ${maxForSection} cards.`,
    };
  }
  if (nextSection < 0) {
    return { ok: false, reason: 'Cannot remove more copies than are present.' };
  }
  // Per-card cap across all sections.
  const nextTotal = input.existingTotalAcrossSections + input.deltaQty;
  const cap = COPY_CAP_BY_STATUS[input.fnlStatus];
  if (nextTotal > cap) {
    if (input.fnlStatus === 'forbidden') {
      return { ok: false, reason: 'This card is Forbidden.' };
    }
    return {
      ok: false,
      reason: `This card is capped at ${cap} across Main + Extra + Side.`,
    };
  }
  // Physical max per row (matches DB check on ygo_deck_cards.quantity).
  if (nextSection > 3) {
    return { ok: false, reason: 'A single section cannot hold more than 3 of one card.' };
  }
  return { ok: true };
}

function sectionLabel(s: Section): string {
  return s === 'main' ? 'Main' : s === 'extra' ? 'Extra' : 'Side';
}
