import type { FnlState } from '../design/tokens';

// Accepts the raw `gamedata.banlist.tcg` string ("unlimited",
// "semi-limited", "limited", "forbidden") plus null/anything unexpected.
// Unknown values collapse to "unknown" so cards without banlist coverage
// do not look alarming in the UI.
//
// Pure function — kept in its own file so tests can exercise it without
// loading the FnlBadge component (which would require JSX transpilation
// inside `node --test`).
export function normaliseFnl(raw: string | null | undefined): FnlState {
  switch ((raw ?? '').toLowerCase().replace(/\s+/g, '-')) {
    case 'forbidden':
      return 'forbidden';
    case 'limited':
      return 'limited';
    case 'semi-limited':
    case 'semilimited':
      return 'semi-limited';
    case 'unlimited':
      return 'unlimited';
    default:
      return 'unknown';
  }
}
