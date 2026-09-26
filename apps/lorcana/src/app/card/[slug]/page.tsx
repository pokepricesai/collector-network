import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCardBundleByName } from '@/server/read';
import { searchCards } from '@/server/search';
import { canonicalFor } from '@/lib/seo';
import { slugifyCardName } from '@/lib/lorcana/slug';
import { pickCardImage } from '@/lib/lorcana/image';
import { LC_INK_LABEL } from '@/lib/lorcana/ink';
import { TREATMENT_DISPLAY_ORDER } from '@/lib/lorcana/treatment';
import CardStatGrid from '@/components/card/CardStatGrid';
import TreatmentPanel from '@/components/card/TreatmentPanel';
import type { LcCardView, LcPrintingView } from '@/server/read';

// Logical / gameplay card page. Shows every printing across every set
// grouped by treatment. This is the URL that answers "how many
// treatments exist for Mickey Mouse - Brave Little Tailor, and what does each cost?" —
// the single most collector-relevant question in Lorcana.

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
  // ("Mickey Mouse - Brave Little Tailor"), apostrophes and other characters the slug drops.
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
    description: `${resolvedName} across every Disney Lorcana set. Base, foil, Enchanted, Iconic, Epic, Legendary and Promo treatments priced individually.`,
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
  // treatment code so the page reads chase-first:
  //   Treasure Rare (1) — panel per printing
  //   Secret Rare (2)
  //   Special Card (1)
  //   Parallel (3)
  //   Leader (2)
  //   Promo (1)
  //   Standard (12)
  //   Reprint (1)
  const flat: Array<{ cardView: LcCardView; printingView: LcPrintingView }> = [];
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
                Disney Lorcana
              </div>
              <h1 style={{ margin: '4px 0 10px', fontSize: 30, lineHeight: 1.15 }}>
                {bundle.name}
              </h1>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {heroCard.gamedata.inks.map((c) => (
                  <span key={c} className={`chip chip-ink chip-ink--${c}`}>
                    {LC_INK_LABEL[c]}
                  </span>
                ))}
                <span className="chip chip-gold" title="Base, foil, Enchanted, Iconic, Epic, Legendary and Promo treatments">
                  {treatmentOrder.length} treatment{treatmentOrder.length === 1 ? '' : 's'} · {flat.length} printing{flat.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            <CardStatGrid gamedata={heroCard.gamedata} classifications={heroCard.gamedata.classifications} />

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
                {heroCard.gamedata.flavourText && (
                  <>
                    <div
                      className="lc-engraved"
                      aria-hidden
                      style={{ margin: '12px 0' }}
                    />
                    <p style={{ margin: 0, lineHeight: 1.55, fontStyle: 'italic', color: 'var(--text-muted)' }}>
                      {heroCard.gamedata.flavourText}
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

function pickHero(cards: LcCardView[]): LcCardView {
  // Lorcana rarity ladder — highest first. Iconic + Enchanted are the
  // marquee art slots and should always claim the hero image.
  const order: Record<string, number> = {
    enchanted: 9, en: 9,
    iconic: 8, ic: 8,
    epic: 7, ep: 7,
    legendary: 6, l: 6,
    'super rare': 5, sr: 5,
    rare: 4, r: 4,
    uncommon: 3, u: 3, uc: 3,
    common: 2, c: 2,
    promo: 1, p: 1,
  };
  const sorted = [...cards].sort((a, b) => {
    const av = order[(a.card.rarity ?? '').toLowerCase()] ?? 0;
    const bv = order[(b.card.rarity ?? '').toLowerCase()] ?? 0;
    return bv - av;
  });
  return sorted[0] ?? cards[0]!;
}

function groupByTreatment(
  entries: Array<{ cardView: LcCardView; printingView: LcPrintingView }>,
) {
  const out = new Map<
    LcPrintingView['treatment']['code'],
    Array<{ cardView: LcCardView; printingView: LcPrintingView }>
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
