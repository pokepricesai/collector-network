// OP graded view — pure-function transform from the raw
// tcg_graded_price_current rows for one anchor into a display-ready
// view. Ports the semantics of apps/mtg's graded-view.ts so the
// guardrails match:
//   • Any row with grader='raw' is NOT a slab and gets filtered out.
//   • Only real stored values are surfaced. Missing cells are absent.
//   • Card-attributed rows are labelled "family estimate" and never
//     surface as an exact-printing slab quote.
//   • The premium block (raw-vs-graded multiple) is intentionally
//     omitted in the first pass — OP raw retail lives elsewhere
//     (@collector-network/market-data) and the strict same-printing
//     + same-currency + freshness rule adds enough surface area that
//     it deserves its own follow-up slice.

import type { TcgGradedRow } from '../../server/graded';

export type GradedCell = {
  grader: string;          // uppercase display: PSA / BGS / CGC / SGC / Any
  grade: string;           // '10', '9.5', '9', '8', '7', …
  price: number;
  currency: string;
  volume: number | null;
  updatedAt: string | null;
  isSlabbed: boolean;      // true for psa/bgs/cgc/sgc; false for 'any'
  attribution: 'printing' | 'card';
};

export type GradedView = {
  /** True if there is at least one slabbed quote worth showing. When
   *  false the caller should render NOTHING. */
  hasSlabbedData: boolean;
  /** Slab-10 hero row: PSA 10 / BGS 10 / CGC 10 / SGC 10. Missing
   *  graders simply absent. */
  slabTen: GradedCell[];
  /** Fallback row for non-10 grades (9.5, 9, 8, 7). */
  anyGraded: GradedCell[];
  /** Everything that survived filtering but doesn't fit above. */
  other: GradedCell[];
  /** Newest updatedAt across the surfaced slabbed rows. */
  lastSlabUpdate: string | null;
  /** True when at least one surfaced row is card-attributed rather
   *  than pinned to the exact printing. UI uses this to add a
   *  "family estimate" disclosure. */
  hasFamilyAttribution: boolean;
  /** Unique currencies among slabbed cells. */
  currencies: string[];
};

const SLABBED_GRADERS = new Set(['psa', 'bgs', 'cgc', 'sgc']);
const TEN_GRADES = new Set(['10', '10.0']);
const FALLBACK_GRADES = new Set(['9.5', '9', '9.0', '8.5', '8', '8.0', '7.5', '7', '7.0']);

function upperGrader(g: string): string {
  const l = g.toLowerCase();
  if (l === 'psa') return 'PSA';
  if (l === 'bgs') return 'BGS';
  if (l === 'cgc') return 'CGC';
  if (l === 'sgc') return 'SGC';
  if (l === 'any') return 'Any';
  return g.toUpperCase();
}

function toCell(r: TcgGradedRow): GradedCell {
  const graderLc = r.grader.toLowerCase();
  return {
    grader: upperGrader(r.grader),
    grade: r.grade,
    price: r.price,
    currency: r.currency,
    volume: r.card_sales_volume ?? null,
    updatedAt: r.updated_at,
    isSlabbed: SLABBED_GRADERS.has(graderLc),
    attribution: r.attribution,
  };
}

function newestOf(cells: readonly GradedCell[]): string | null {
  let best: string | null = null;
  for (const c of cells) {
    if (!c.updatedAt) continue;
    if (!best || c.updatedAt > best) best = c.updatedAt;
  }
  return best;
}

export function buildGradedView(rows: readonly TcgGradedRow[]): GradedView {
  // Filter: drop raw/unknown, keep only slabbed graders + 'any' as
  // a fallback bucket.
  const kept: GradedCell[] = [];
  for (const r of rows) {
    const graderLc = r.grader.toLowerCase();
    if (graderLc === 'raw') continue;
    if (!SLABBED_GRADERS.has(graderLc) && graderLc !== 'any') continue;
    kept.push(toCell(r));
  }

  // De-dup on (grader, grade, currency, attribution) — prefer
  // printing-attributed row if both a printing and card-attributed
  // row exist for the same shape.
  const dedup = new Map<string, GradedCell>();
  for (const c of kept) {
    const key = `${c.grader}|${c.grade}|${c.currency}`;
    const existing = dedup.get(key);
    if (!existing) {
      dedup.set(key, c);
      continue;
    }
    // Prefer printing attribution.
    if (existing.attribution === 'card' && c.attribution === 'printing') {
      dedup.set(key, c);
    }
  }
  const all = [...dedup.values()];

  const slabTen: GradedCell[] = [];
  const anyGraded: GradedCell[] = [];
  const other: GradedCell[] = [];
  for (const c of all) {
    if (c.isSlabbed && TEN_GRADES.has(c.grade)) slabTen.push(c);
    else if (FALLBACK_GRADES.has(c.grade)) anyGraded.push(c);
    else other.push(c);
  }

  // Stable presentation order per bucket.
  const GRADER_ORDER = ['PSA', 'BGS', 'CGC', 'SGC', 'Any'];
  const sortByGrader = (a: GradedCell, b: GradedCell) =>
    GRADER_ORDER.indexOf(a.grader) - GRADER_ORDER.indexOf(b.grader);
  slabTen.sort(sortByGrader);

  // Sort fallback by numeric grade desc so 9.5 > 9 > 8.5 > 8 > 7.
  const parseGrade = (g: string) => Number.parseFloat(g);
  anyGraded.sort((a, b) => {
    const gd = parseGrade(b.grade) - parseGrade(a.grade);
    if (gd !== 0) return gd;
    return sortByGrader(a, b);
  });

  const currencies = Array.from(new Set(slabTen.map((c) => c.currency)));

  return {
    hasSlabbedData: slabTen.length > 0 || anyGraded.length > 0,
    slabTen,
    anyGraded,
    other,
    lastSlabUpdate: newestOf([...slabTen, ...anyGraded]),
    hasFamilyAttribution: all.some((c) => c.attribution === 'card'),
    currencies,
  };
}
