import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCardBundleByName } from '@/server/read';
import { searchCards } from '@/server/search';
import { canonicalFor } from '@/lib/seo';
import { slugifyCardName } from '@/lib/onepiece/slug';
import { pickCardImage } from '@/lib/onepiece/image';
import { OP_COLOUR_LABEL } from '@/lib/onepiece/colour';
import { TREATMENT_DISPLAY_ORDER } from '@/lib/onepiece/treatment';
import CardStatGrid from '@/components/card/CardStatGrid';
import TreatmentPanel from '@/components/card/TreatmentPanel';
import type { OpCardView, OpPrintingView } from '@/server/read';

// Logical / gameplay card page. Shows every printing across every set
// grouped by treatment. This is the URL that answers "how many
// treatments exist for Monkey D. Luffy, and what does each cost?" —
// the single most collector-relevant question in One Piece.

export const revalidate = 900;
export const dynamic = 'force-dynamic';

// Best-effort reverse lookup: turn the slug back into a plausible
// name. Names contain dots, ellipses and non-ASCII characters that
// we can't fully round-trip. If the naive spaced-out slug misses, we
// fall back to a name search and pick the exact slug match.
async function resolveCardName(slug: string): Promise<string | null> {
  const naive = slug.replace(/-/g, ' ');
  const bundle = await getCardBundleByName(naive);
  if (bundle) return bundle.name;
  // Fallback: fuzzy search + slug re-match. Handles names with dots
  // ("Monkey D. Luffy"), apostrophes and other characters the slug drops.
  const candidates = await searchCards(naive.slice(0, 40), 40);
  const hit = candidates.find((c) => slugifyCardName(c.name) === slug);
  return hit?.name ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const resolvedName = await resolveCardName(slug);
  if (!resolvedName) return { title: 'Card not found' };
  return {
    title: `${resolvedName} — every printing, treatment and price`,
    description: `${resolvedName} across every One Piece Card Game set. Standard, parallel, alternate art, manga rare and secret rare treatments priced individually.`,
    alternates: { canonical: canonicalFor(`/card/${slugifyCardName(resolvedName)}`) },
  };
}

export default async function LogicalCardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resolvedName = await resolveCardName(slug);
  if (!resolvedName) notFound();
  const bundle = await getCardBundleByName(resolvedName);
  if (!bundle) notFound();

  // Flatten all treatment printings from every rarity row, then group by
  // treatment code so the page reads like:
  //   Alternate Art (2) — panel per printing
  //   Manga Rare (1)
  //   Secret Rare (1)
  //   Parallel (2)
  //   Standard (12)
  const flat: Array<{ cardView: OpCardView; printingView: OpPrintingView }> = [];
  for (const c of bundle.cards) {
    for (const p of c.printings) flat.push({ cardView: c, printingView: p });
  }

  // Pick hero art from the highest-rarity card row.
  const heroCard = pickHero(bundle.cards);
  const heroImage = pickCardImage(heroCard.card.images);

  const grouped = groupByTreatment(flat);
  const treatmentOrder: Array<{
    label: string;
    code: (typeof flat)[number]['printingView']['treatment']['code'];
    entries: typeof flat;
  }> = [];
  for (const code of TREATMENT_DISPLAY_ORDER) {
    const entries = grouped.get(code);
    if (!entries || entries.length === 0) continue;
    treatmentOrder.push({ label: entries[0]!.printingView.treatment.label, code, entries });
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: bundle.name,
    url: canonicalFor(`/card/${slugifyCardName(bundle.name)}`),
    description: `${bundle.name} — every printing and treatment.`,
  } as const;

  return (
    <div style={{ padding: '32px 24px' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <Breadcrumbs name={bundle.name} />

        <div
          className="op-card-halo op-card-hero-grid"
          style={{
            gap: 28,
            alignItems: 'flex-start',
          }}
        >
          <div
            style={{
              background:
                'linear-gradient(180deg, var(--bg-light) 0%, var(--bg-strong) 100%)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              overflow: 'hidden',
              aspectRatio: '5 / 7',
            }}
          >
            {heroImage ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={heroImage}
                alt={bundle.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <div className="op-card-empty" aria-hidden>
                <span>Art loading</span>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
                One Piece Card Game
              </div>
              <h1 style={{ margin: '4px 0 10px', fontSize: 30, lineHeight: 1.15 }}>
                {bundle.name}
              </h1>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {heroCard.gamedata.colours.map((c) => (
                  <span key={c} className={`chip chip-${c}`}>
                    {OP_COLOUR_LABEL[c]}
                  </span>
                ))}
                <span className="chip chip-gold" title="Standard, parallel, alternate art, manga rare, secret rare and promo treatments">
                  {treatmentOrder.length} treatment{treatmentOrder.length === 1 ? '' : 's'} · {flat.length} printing{flat.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            <CardStatGrid gamedata={heroCard.gamedata} types={heroCard.gamedata.types} />

            {heroCard.gamedata.effectText && (
              <div
                style={{
                  padding: 16,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                }}
              >
                <div className="label-mono" style={{ marginBottom: 6 }}>
                  Effect
                </div>
                <p style={{ margin: 0, lineHeight: 1.55 }}>
                  {heroCard.gamedata.effectText}
                </p>
                {heroCard.gamedata.triggerText && (
                  <>
                    <div
                      className="op-engraved"
                      aria-hidden
                      style={{ margin: '12px 0' }}
                    />
                    <div className="label-mono" style={{ marginBottom: 6 }}>
                      Trigger
                    </div>
                    <p style={{ margin: 0, lineHeight: 1.55 }}>
                      {heroCard.gamedata.triggerText}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <section style={{ marginTop: 36, display: 'grid', gap: 20 }}>
          <header>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              Treatments
            </div>
            <h2 style={{ margin: '4px 0 0', fontSize: 22 }}>
              Priced individually
            </h2>
            <p
              style={{
                margin: '6px 0 0',
                color: 'var(--text-muted)',
                fontSize: 14,
                lineHeight: 1.55,
                maxWidth: 640,
              }}
            >
              Every treatment for {bundle.name} is a separate priced entity. Rarer
              treatments appear first so the chase versions of this card are always
              visible above the standard printing.
            </p>
          </header>

          {treatmentOrder.map((group) => (
            <div key={group.code} style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className={`treatment-badge treatment-badge--${group.code}`}>
                  {group.label}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: 'var(--text-muted)',
                    fontWeight: 600,
                  }}
                >
                  {group.entries.length} printing
                  {group.entries.length === 1 ? '' : 's'}
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
                  gap: 12,
                }}
              >
                {group.entries.map(({ cardView, printingView }) => (
                  <TreatmentPanel
                    key={printingView.printing.id}
                    cardView={cardView}
                    printingView={printingView}
                    linkToPrinting
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function pickHero(cards: OpCardView[]): OpCardView {
  const order: Record<string, number> = {
    SEC: 6, secret: 6, 'secret rare': 6,
    SR: 5, 'super rare': 5,
    L: 4, leader: 4,
    R: 3, rare: 3,
    UC: 2, uncommon: 2,
    C: 1, common: 1,
  };
  const sorted = [...cards].sort((a, b) => {
    const av = order[(a.card.rarity ?? '').toLowerCase()] ?? 0;
    const bv = order[(b.card.rarity ?? '').toLowerCase()] ?? 0;
    return bv - av;
  });
  return sorted[0] ?? cards[0]!;
}

function groupByTreatment(
  entries: Array<{ cardView: OpCardView; printingView: OpPrintingView }>,
) {
  const out = new Map<
    OpPrintingView['treatment']['code'],
    Array<{ cardView: OpCardView; printingView: OpPrintingView }>
  >();
  for (const e of entries) {
    const key = e.printingView.treatment.code;
    const bucket = out.get(key);
    if (bucket) bucket.push(e);
    else out.set(key, [e]);
  }
  return out;
}

function Breadcrumbs({ name }: { name: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        marginBottom: 16,
        fontSize: 13,
        color: 'var(--text-muted)',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
        Home
      </Link>
      <span aria-hidden>›</span>
      <Link
        href="/cards/search"
        style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
      >
        Cards
      </Link>
      <span aria-hidden>›</span>
      <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{name}</span>
    </nav>
  );
}
