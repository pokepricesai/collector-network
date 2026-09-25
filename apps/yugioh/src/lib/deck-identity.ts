// Slice F — pure gameplay-identity + section-classification helpers.
//
// The gameplay identity of a Yu-Gi-Oh card is currently modelled as
// a normalised English name because the live catalogue has no other
// stable per-card identifier (english_id / konami password / passcode
// are all null; tcggraph_card_id and tcg_cards.id are per-printing).
//
// `normaliseCardKey` is the canonical transform. Everything on the
// server that derives an identity — writes, quantity aggregation,
// F&L legality — MUST go through it. The client never invents a
// card_key: server derives it from the canonical card name resolved
// against tcg_cards. See docs/yugioh/schema-request-slice-f.md.

export type Section = 'main' | 'extra' | 'side';
export const SECTIONS: readonly Section[] = ['main', 'extra', 'side'];

export type FnlStatus = 'forbidden' | 'limited' | 'semi-limited' | 'unlimited';

// One place: the physical maximum copies of a card in an entire
// deck (Main + Extra + Side combined) given its F&L status.
// Kept centralised so every write path + every UI hint uses the
// same source of truth.
export const COPY_CAP_BY_STATUS: Record<FnlStatus, number> = {
  forbidden: 0,
  limited: 1,
  'semi-limited': 2,
  unlimited: 3,
};

// TCG deck-size rules as of 2026. Centralised + tested.
export const DECK_SIZE_RULES = {
  main: { min: 40, max: 60 },
  extra: { min: 0, max: 15 },
  side: { min: 0, max: 15 },
} as const;

// Which frame types belong in the Extra Deck?
export const EXTRA_DECK_FRAMES = new Set<string>([
  'fusion',
  'synchro',
  'xyz',
  'link',
]);

// Normalise a card's display name into its stable gameplay key.
//
// Contract:
//   • Deterministic (`normaliseCardKey(x) === normaliseCardKey(x)`).
//   • Idempotent (`normaliseCardKey(normaliseCardKey(x)) === normaliseCardKey(x)`).
//   • Case-folded.
//   • Whitespace collapsed to single spaces.
//   • NFKD-normalised so accented reprints share a key with English.
//   • Trims wrapping whitespace.
//
// It does NOT strip punctuation the way toCardSlug() does — we want
// "Number 39: Utopia" and "Number 39 Utopia" to remain distinct.
export function normaliseCardKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Which sections is this frame type allowed to occupy?
// Applies to any card whose frame belongs to the Extra Deck: fusion,
// synchro, xyz, link (all currently represented in the catalogue).
// Everything else (normal, effect, ritual, spell, trap) is Main-or-
// Side.
export function allowedSections(frameType: string | null | undefined): Section[] {
  const ft = (frameType ?? '').toLowerCase();
  if (EXTRA_DECK_FRAMES.has(ft)) return ['extra'];
  return ['main', 'side'];
}

// Read the TCG F&L status from a card's gamedata blob. Defaults to
// unlimited when no banlist entry is present. Only the TCG list is
// consulted — the OCG list lives in the same blob but is a separate
// jurisdiction.
export function readFnlStatus(gamedata: unknown): FnlStatus {
  if (!gamedata || typeof gamedata !== 'object') return 'unlimited';
  const banlist = (gamedata as Record<string, unknown>)['banlist'];
  if (!banlist || typeof banlist !== 'object') return 'unlimited';
  const raw = (banlist as Record<string, unknown>)['tcg'];
  if (typeof raw !== 'string') return 'unlimited';
  const lower = raw.toLowerCase().trim();
  if (lower === 'forbidden' || lower === 'banned') return 'forbidden';
  if (lower === 'limited') return 'limited';
  if (lower === 'semi-limited' || lower === 'semi_limited' || lower === 'semilimited')
    return 'semi-limited';
  return 'unlimited';
}

// Simple frame → readable label. Kept here so search results, deck
// rows and stats panels agree on wording.
export function frameLabel(frameType: string | null | undefined): string {
  const ft = (frameType ?? '').toLowerCase();
  switch (ft) {
    case 'normal': return 'Normal Monster';
    case 'effect': return 'Effect Monster';
    case 'ritual': return 'Ritual Monster';
    case 'fusion': return 'Fusion Monster';
    case 'synchro': return 'Synchro Monster';
    case 'xyz': return 'Xyz Monster';
    case 'link': return 'Link Monster';
    case 'pendulum': return 'Pendulum Monster';
    case 'spell': return 'Spell Card';
    case 'trap': return 'Trap Card';
    default: return ft ? ft : 'Unknown';
  }
}

// True when the frame type is a monster (any kind).
export function isMonsterFrame(frameType: string | null | undefined): boolean {
  const ft = (frameType ?? '').toLowerCase();
  return ft !== 'spell' && ft !== 'trap' && ft.length > 0;
}
