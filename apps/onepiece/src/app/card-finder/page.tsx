import type { Metadata } from 'next';
import Link from 'next/link';
import { canonicalFor } from '@/lib/seo';
import { OP_COLOURS, OP_COLOUR_LABEL } from '@/lib/onepiece/colour';
import { OP_CARD_TYPES, OP_CARD_TYPE_LABEL } from '@/lib/onepiece/card-type';
import { OP_TREATMENTS } from '@/lib/onepiece/treatment';

export const metadata: Metadata = {
  title: 'One Piece card finder — filter by colour, cost, power, counter and more',
  description:
    'Filter every One Piece Card Game card by colour, cost, power, counter, life, attribute, trigger, type / crew and language.',
  alternates: { canonical: canonicalFor('/card-finder') },
};

// V1 card-finder page. Renders the filter vocabulary and search
// entry point. Interactive filtering lands after the ingest pipeline
// populates gamedata reliably — until then this page teaches the
// vocabulary and links out to /cards/search.

export default function CardFinderPage() {
  const treatmentKeys = Object.keys(OP_TREATMENTS) as Array<keyof typeof OP_TREATMENTS>;

  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="op-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              Card Finder
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 30 }}>
              Filter every One Piece card
            </h1>
            <p
              style={{
                margin: 0,
                color: 'var(--text-muted)',
                fontSize: 15,
                maxWidth: 640,
                lineHeight: 1.55,
              }}
            >
              A capability-based finder for collectors and players. Combine
              colour, cost, power, counter, life, attribute, trigger and type
              / crew filters. Language and treatment axes live alongside them.
            </p>
          </div>
        </header>

        <div style={{ display: 'grid', gap: 20 }}>
          <FacetGroup title="Colour" description="Base colours (mono or multi).">
            {OP_COLOURS.map((c) => (
              <Link
                key={c}
                href={`/colours/${c}`}
                className={`chip chip-${c}`}
                style={{ textDecoration: 'none' }}
              >
                {OP_COLOUR_LABEL[c]}
              </Link>
            ))}
          </FacetGroup>

          <FacetGroup title="Card type" description="One of Leader / Character / Event / Stage / DON!!">
            {OP_CARD_TYPES.map((t) => (
              <span key={t} className="chip">
                {OP_CARD_TYPE_LABEL[t]}
              </span>
            ))}
          </FacetGroup>

          <FacetGroup title="Treatment" description="Standard vs the chase axes.">
            {treatmentKeys.map((k) => (
              <span
                key={k}
                className={`treatment-badge treatment-badge--${k}`}
                style={{ textTransform: 'none' }}
              >
                {OP_TREATMENTS[k].label}
              </span>
            ))}
          </FacetGroup>

          <FacetGroup
            title="Gameplay stats"
            description="Cost / Power / Counter / Life ranges — sliders arriving next slice."
          >
            <span className="chip">Cost 0–10</span>
            <span className="chip">Power 0–15000</span>
            <span className="chip">Counter +1000 / +2000</span>
            <span className="chip">Life 1–5</span>
          </FacetGroup>

          <FacetGroup
            title="Attribute"
            description="Slash / Strike / Ranged / Special / Wisdom — the attack axis."
          >
            {['Slash', 'Strike', 'Ranged', 'Special', 'Wisdom'].map((a) => (
              <span key={a} className="chip chip-ocean">
                {a}
              </span>
            ))}
          </FacetGroup>

          <FacetGroup
            title="Language"
            description="Cards are printed in Japanese first — English printings usually follow a set behind."
          >
            <span className="chip">EN</span>
            <span className="chip">JP</span>
          </FacetGroup>

          <div
            style={{
              padding: 18,
              background: 'var(--surface)',
              border: '1px dashed var(--border-strong)',
              borderRadius: 14,
              color: 'var(--text-muted)',
              fontSize: 14,
              lineHeight: 1.55,
            }}
          >
            Interactive filtering is coming soon. In the meantime{' '}
            <Link href="/browse" style={{ fontWeight: 700 }}>
              browse by set
            </Link>{' '}
            or{' '}
            <Link href="/cards/search" style={{ fontWeight: 700 }}>
              search by name
            </Link>
            .
          </div>
        </div>
      </div>
    </div>
  );
}

function FacetGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        padding: 18,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
      }}
    >
      <header style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        <p
          style={{
            margin: '4px 0 0',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          {description}
        </p>
      </header>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>
    </section>
  );
}
