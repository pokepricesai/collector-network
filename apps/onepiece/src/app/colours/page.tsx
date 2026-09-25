import type { Metadata } from 'next';
import Link from 'next/link';
import { OP_COLOURS, OP_COLOUR_LABEL } from '@/lib/onepiece/colour';
import { canonicalFor } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'One Piece card colours — Red, Green, Blue, Purple, Black, Yellow',
  description:
    'Browse One Piece Card Game cards by colour. Six colours (Red, Green, Blue, Purple, Black, Yellow) plus every multi-colour Leader pairing.',
  alternates: { canonical: canonicalFor('/colours') },
};

const COLOUR_DESCRIPTIONS: Record<(typeof OP_COLOURS)[number], string> = {
  red: 'Aggressive, rush-forward strategies. Straw Hats, Whitebeard Pirates, Marines.',
  green: 'Tempo control with Rest / Active-swap tricks. Kid Pirates, Roger Pirates, Warlords.',
  blue: 'Card advantage, disruption and lockdown. Impel Down, Baroque Works, Cipher Pol.',
  purple: 'DON!! acceleration and boss-style combos. Kaido, Big Mom, Yonko archetypes.',
  black: 'Cost manipulation and denial. Blackbeard Pirates, Cross Guild, dark storylines.',
  yellow: 'Late-game recursion and life engineering. Charlotte family, Sky Island, God tribes.',
};

export default function ColoursIndex() {
  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="op-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              Colours
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 30 }}>
              Browse by colour
            </h1>
            <p
              style={{
                margin: 0,
                color: 'var(--text-muted)',
                fontSize: 15,
                lineHeight: 1.55,
                maxWidth: 640,
              }}
            >
              The six One Piece card colours anchor deckbuilding and collector
              discovery. Every Leader binds one or two colours; every Character
              inherits from those constraints. Choose a colour to see its
              Leaders and top-value chase cards.
            </p>
          </div>
        </header>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          {OP_COLOURS.map((c) => (
            <Link
              key={c}
              href={`/colours/${c}`}
              className="card-hover card-hover-gold"
              style={{
                display: 'grid',
                gap: 10,
                padding: 18,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                textDecoration: 'none',
                color: 'var(--text)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`chip chip-${c}`}>{OP_COLOUR_LABEL[c]}</span>
              </div>
              <p
                style={{
                  margin: 0,
                  color: 'var(--text-muted)',
                  fontSize: 14,
                  lineHeight: 1.55,
                }}
              >
                {COLOUR_DESCRIPTIONS[c]}
              </p>
              <span
                style={{
                  color: 'var(--primary)',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                Open →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
