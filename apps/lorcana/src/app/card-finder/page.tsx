import type { Metadata } from 'next';
import Link from 'next/link';
import { canonicalFor } from '@/lib/seo';
import { LC_INKS, LC_INK_LABEL, LC_INK_DESCRIPTOR } from '@/lib/lorcana/ink';
import { LC_CARD_TYPES, LC_CARD_TYPE_LABEL } from '@/lib/lorcana/card-type';

export const metadata: Metadata = {
  title: 'Lorcana card finder — filter by ink, cost, strength, lore and more',
  description:
    'Filter every Disney Lorcana card by ink, ink cost, lore, strength, willpower, inkable status, classification and treatment.',
  alternates: { canonical: canonicalFor('/card-finder') },
};

// V1 card-finder page. Renders the filter vocabulary and search entry
// point. Interactive filtering lands after the ingest pipeline
// populates gamedata reliably — until then this page teaches the
// vocabulary and links out to /cards/search.

const CHASE_TIERS: Array<{ code: string; label: string }> = [
  { code: 'enchanted', label: 'Enchanted' },
  { code: 'iconic', label: 'Iconic' },
  { code: 'epic', label: 'Epic' },
  { code: 'legendary', label: 'Legendary' },
  { code: 'super-rare', label: 'Super rare' },
  { code: 'rare', label: 'Rare' },
  { code: 'uncommon', label: 'Uncommon' },
  { code: 'common', label: 'Common' },
  { code: 'promo', label: 'Promo' },
];

export default function CardFinderPage() {
  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="lc-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--accent-2)' }}>
              Card Finder
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 30 }}>
              Filter every Lorcana card
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
              ink, ink cost, lore, strength, willpower, card type, inkability,
              classifications and rarity. Foil × nonfoil and chase treatments
              layer on top.
            </p>
          </div>
        </header>

        <div style={{ display: 'grid', gap: 20 }}>
          <FacetGroup title="Ink" description="One of the six inks — Amber, Amethyst, Emerald, Ruby, Sapphire, Steel.">
            {LC_INKS.map((c) => (
              <Link
                key={c}
                href={`/inks/${c}`}
                className={`chip chip-ink chip-ink--${c}`}
                style={{ textDecoration: 'none' }}
                title={LC_INK_DESCRIPTOR[c]}
              >
                {LC_INK_LABEL[c]}
              </Link>
            ))}
          </FacetGroup>

          <FacetGroup title="Card type" description="Character / Action / Song / Item / Location.">
            {LC_CARD_TYPES.map((t) => (
              <span key={t} className="chip">
                {LC_CARD_TYPE_LABEL[t]}
              </span>
            ))}
          </FacetGroup>

          <FacetGroup title="Rarity & chase" description="The Lorcana rarity ladder plus Promo.">
            {CHASE_TIERS.map((k) => (
              <span key={k.code} className={`treatment-badge treatment-badge--${k.code}`}>
                {k.label}
              </span>
            ))}
          </FacetGroup>

          <FacetGroup title="Treatment (finish)" description="Every printing exists as nonfoil or cold foil.">
            <span className="treatment-badge treatment-badge--nonfoil">Nonfoil</span>
            <span className="treatment-badge treatment-badge--foil">Cold Foil</span>
          </FacetGroup>

          <FacetGroup
            title="Gameplay stats"
            description="Ink cost / Lore / Strength / Willpower / Move cost — sliders arriving next slice."
          >
            <span className="chip">Cost 0–10</span>
            <span className="chip">Lore 0–4</span>
            <span className="chip">Strength 0–10</span>
            <span className="chip">Willpower 1–10</span>
            <span className="chip">Move cost 1–3</span>
          </FacetGroup>

          <FacetGroup
            title="Inkability"
            description="Can this card be spent as ink? A binary axis every deck cares about."
          >
            <span className="chip">Inkable</span>
            <span className="chip">Uninkable</span>
          </FacetGroup>

          <FacetGroup
            title="Classifications"
            description="Storyborn / Dreamborn / Floodborn plus role and race tags."
          >
            {[
              'Storyborn', 'Dreamborn', 'Floodborn',
              'Villain', 'Hero', 'Ally', 'Prince', 'Princess',
              'Sorcerer', 'Musketeer', 'Pirate', 'Dragon', 'Fairy',
            ].map((a) => (
              <span key={a} className="chip">
                {a}
              </span>
            ))}
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
