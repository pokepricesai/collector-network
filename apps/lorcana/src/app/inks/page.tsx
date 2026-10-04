import type { Metadata } from 'next';
import Link from 'next/link';
import { LC_INKS, LC_INK_LABEL, LC_INK_DESCRIPTOR } from '@/lib/lorcana/ink';
import { canonicalFor } from '@/lib/seo';
import Faq from '@/components/Faq';
import { INKS_FAQ } from '@/lib/faq-content';

export const metadata: Metadata = {
  title: 'Lorcana ink colours. Amber, Amethyst, Emerald, Ruby, Sapphire, Steel',
  description:
    'Browse Disney Lorcana cards by ink. Six inks. Amber, Amethyst, Emerald, Ruby, Sapphire and Steel, anchor deckbuilding and collector discovery.',
  alternates: { canonical: canonicalFor('/inks') },
};

const INK_DESCRIPTIONS: Record<(typeof LC_INKS)[number], string> = {
  amber:    'Healing, community, songs. Herald of Harmony, Belle, cleric-leaning support strategies.',
  amethyst: 'Mystic, ethereal, sorcerer-flavour. Elsa, Merlin, spell-echo lore engines.',
  emerald:  'Trickster shenanigans and card manipulation. Peter Pan, Genie, tempo swings.',
  ruby:     'Passion, aggression, glory. Mickey Mouse - Brave Little Tailor, wide-attack pressure.',
  sapphire: 'Wisdom, invention, artifice. Merlin, Merlin - Rabbit, item-heavy strategies.',
  steel:    'Resilience, courage, force. Beast, Simba, big-body defenders and combat tricks.',
};

export default function InksIndex() {
  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="lc-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--accent-2)' }}>
              Inks
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 30 }}>
              Browse by ink
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
              The six Lorcana inks anchor deckbuilding, ink-cost curves and
              collector discovery. Every character binds one ink (a handful
              are dual-ink); every deck mixes two. Pick an ink to see its
              most-valuable cards and its Enchanted, Iconic and Epic
              overprints.
            </p>
          </div>
        </header>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
            gap: 14,
          }}
        >
          {LC_INKS.map((ink) => (
            <Link
              key={ink}
              href={`/inks/${ink}`}
              className="lc-hover lc-hover-gold"
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className={`chip chip-ink chip-ink--${ink}`}>{LC_INK_LABEL[ink]}</span>
                <span className="label-mono">{LC_INK_DESCRIPTOR[ink]}</span>
              </div>
              <p
                style={{
                  margin: 0,
                  color: 'var(--text-muted)',
                  fontSize: 14,
                  lineHeight: 1.55,
                }}
              >
                {INK_DESCRIPTIONS[ink]}
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

        <Faq title="About Lorcana inks" entries={INKS_FAQ} />
      </div>
    </div>
  );
}
