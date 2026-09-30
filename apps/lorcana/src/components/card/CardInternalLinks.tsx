import Link from 'next/link';
import type { InternalLinkTile } from '@/server/internal-links';
import { LC_INK_LABEL } from '@/lib/lorcana/ink';
import type { LcInk } from '@/lib/lorcana/ink';

// Server-rendered internal-linking block that lives beneath the FAQ on
// every /card/[slug] page. Purpose: expose crawlable, tightly-capped
// links to nearby cards so a card page never becomes a dead end for
// search engines or human collectors.
//
// Every section is skipped entirely when it would render zero tiles.
// Links use real routes only; no query-only breadcrumbs.

export interface CardInternalLinksProps {
  cardName: string;
  moreFromSet: InternalLinkTile[];
  otherCharacterCards: InternalLinkTile[];
  sameRarity: InternalLinkTile[];
  sameInk: InternalLinkTile[];
  setCode: string | null;
  setName: string | null;
  rarityLabel: string | null;
  primaryInk: LcInk | null;
  isCharacter: boolean;
}

export default function CardInternalLinks(props: CardInternalLinksProps) {
  const {
    moreFromSet,
    otherCharacterCards,
    sameRarity,
    sameInk,
    setCode,
    setName,
    rarityLabel,
    primaryInk,
    isCharacter,
  } = props;

  const anySection =
    moreFromSet.length > 0 ||
    otherCharacterCards.length > 0 ||
    sameRarity.length > 0 ||
    sameInk.length > 0;

  // Explore block always renders when we have SOMETHING to link out to.
  const showExplore = Boolean(setCode) || Boolean(rarityLabel) || isCharacter;
  if (!anySection && !showExplore) return null;

  return (
    <section
      aria-label="Related Lorcana cards"
      style={{
        marginTop: 40,
        display: 'grid',
        gap: 28,
      }}
    >
      {moreFromSet.length > 0 && (
        <LinkGroup
          heading={setName ? `More from ${setName}` : 'More from this set'}
          seeMoreHref={setCode ? `/set/${encodeURIComponent(setCode.toLowerCase())}` : null}
          seeMoreLabel={setCode ? 'Browse whole set →' : null}
          tiles={moreFromSet}
        />
      )}

      {isCharacter && otherCharacterCards.length > 0 && (
        <LinkGroup
          heading={`Other cards featuring ${props.cardName.split(' - ')[0] ?? props.cardName}`}
          seeMoreHref={null}
          seeMoreLabel={null}
          tiles={otherCharacterCards}
        />
      )}

      {sameRarity.length > 0 && rarityLabel && (
        <LinkGroup
          heading={`More ${rarityLabel} cards`}
          seeMoreHref={`/card-finder?rarity=${encodeURIComponent(rarityLabel)}`}
          seeMoreLabel={`Browse all ${rarityLabel} →`}
          tiles={sameRarity}
        />
      )}

      {sameInk.length > 0 && primaryInk && (
        <LinkGroup
          heading={`More ${LC_INK_LABEL[primaryInk]} cards`}
          seeMoreHref={`/inks/${primaryInk}`}
          seeMoreLabel={`Explore ${LC_INK_LABEL[primaryInk]} →`}
          tiles={sameInk}
        />
      )}

      {showExplore && (
        <ExploreBlock
          setCode={setCode}
          setName={setName}
          rarityLabel={rarityLabel}
          isCharacter={isCharacter}
        />
      )}
    </section>
  );
}

function LinkGroup({
  heading,
  seeMoreHref,
  seeMoreLabel,
  tiles,
}: {
  heading: string;
  seeMoreHref: string | null;
  seeMoreLabel: string | null;
  tiles: InternalLinkTile[];
}) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, letterSpacing: '-0.01em' }}>
          {heading}
        </h2>
        {seeMoreHref && seeMoreLabel && (
          <Link
            href={seeMoreHref}
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--accent-2, var(--text))',
              textDecoration: 'none',
            }}
          >
            {seeMoreLabel}
          </Link>
        )}
      </div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 10,
        }}
      >
        {tiles.map((t) => (
          <li key={t.cardId} style={{ minWidth: 0 }}>
            <Link
              href={`/card/${t.slug}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 10,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                textDecoration: 'none',
                color: 'var(--text)',
                minWidth: 0,
              }}
            >
              <div
                style={{
                  aspectRatio: '5 / 7',
                  overflow: 'hidden',
                  borderRadius: 6,
                  background: 'var(--bg-strong)',
                }}
              >
                {t.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={t.imageUrl}
                    alt={t.name}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : null}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>
                {t.name}
              </div>
              {(t.setCode || t.rarity) && (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    letterSpacing: '0.02em',
                  }}
                >
                  {t.setCode ? t.setCode.toUpperCase() : ''}
                  {t.setCode && t.rarity ? ' · ' : ''}
                  {t.rarity ?? ''}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExploreBlock({
  setCode,
  setName,
  rarityLabel,
  isCharacter,
}: {
  setCode: string | null;
  setName: string | null;
  rarityLabel: string | null;
  isCharacter: boolean;
}) {
  const links: Array<{ href: string; label: string }> = [];
  if (setCode) {
    links.push({
      href: `/set/${encodeURIComponent(setCode.toLowerCase())}`,
      label: setName ? `${setName} set page` : `${setCode.toUpperCase()} set page`,
    });
  }
  if (rarityLabel) {
    links.push({
      href: `/card-finder?rarity=${encodeURIComponent(rarityLabel)}`,
      label: `All ${rarityLabel} cards`,
    });
  }
  if (isCharacter) {
    links.push({ href: '/characters', label: 'All Lorcana characters' });
  }
  links.push({ href: '/card-finder', label: 'Lorcana card finder' });
  links.push({ href: '/browse', label: 'Every Lorcana set' });

  return (
    <div
      style={{
        padding: 16,
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--surface)',
      }}
    >
      <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Explore Lorcana</h2>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link
              href={l.href}
              style={{
                display: 'inline-block',
                padding: '6px 12px',
                borderRadius: 999,
                border: '1px solid var(--border)',
                background: 'var(--bg-light, var(--surface))',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text)',
                textDecoration: 'none',
              }}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
