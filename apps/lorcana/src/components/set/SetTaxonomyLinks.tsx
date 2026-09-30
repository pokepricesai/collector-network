import Link from 'next/link';
import type { CharacterInSet } from '@/server/internal-links';
import { LC_INK_LABEL, type LcInk } from '@/lib/lorcana/ink';

// Set-page internal-linking block. Renders below the card grid so the
// set page never becomes a dead-end for a crawler or a collector who
// wants to jump sideways into a character / ink / rarity view.
//
// Cap: top 10 characters, every ink represented, every rarity
// represented + hub links. Skipped when data is empty.

export interface SetTaxonomyLinksProps {
  characters: CharacterInSet[];
  inks: string[];
  rarities: string[];
}

export default function SetTaxonomyLinks(props: SetTaxonomyLinksProps) {
  const topCharacters = props.characters.slice(0, 10);
  const anyCharacter = topCharacters.length > 0;
  const anyInk = props.inks.length > 0;
  const anyRarity = props.rarities.length > 0;
  if (!anyCharacter && !anyInk && !anyRarity) return null;

  return (
    <section
      aria-label="Explore this set"
      style={{
        marginTop: 32,
        marginBottom: 24,
        padding: 20,
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--surface)',
        display: 'grid',
        gap: 18,
      }}
    >
      <div>
        <h2 style={{ margin: 0, fontSize: 18, letterSpacing: '-0.01em' }}>
          Explore this set
        </h2>
        <p
          style={{
            margin: '4px 0 0',
            fontSize: 13,
            color: 'var(--text-muted)',
          }}
        >
          Jump into the characters, inks and rarities that appear here.
        </p>
      </div>

      {anyCharacter && (
        <TaxonomyGroup
          heading="Characters in this set"
          tiles={topCharacters.map((c) => ({
            href: `/character/${c.slug}`,
            label: `${c.name}${c.count > 1 ? ` · ${c.count}` : ''}`,
          }))}
        />
      )}

      {anyInk && (
        <TaxonomyGroup
          heading="Inks represented"
          tiles={props.inks.map((ink) => {
            const k = ink.toLowerCase() as LcInk;
            const label = LC_INK_LABEL[k] ?? ink;
            return {
              href: `/inks/${encodeURIComponent(ink.toLowerCase())}`,
              label: `${label} cards`,
            };
          })}
        />
      )}

      {anyRarity && (
        <TaxonomyGroup
          heading="Rarities in this set"
          tiles={props.rarities.map((r) => ({
            href: `/card-finder?rarity=${encodeURIComponent(r)}`,
            label: r,
          }))}
        />
      )}

      <TaxonomyGroup
        heading="Related hubs"
        tiles={[
          { href: '/browse', label: 'Every Lorcana set' },
          { href: '/card-finder', label: 'Card finder' },
          { href: '/characters', label: 'All characters' },
          { href: '/inks', label: 'Browse by ink' },
        ]}
      />
    </section>
  );
}

function TaxonomyGroup({
  heading,
  tiles,
}: {
  heading: string;
  tiles: Array<{ href: string; label: string }>;
}) {
  if (tiles.length === 0) return null;
  return (
    <div>
      <div
        className="label-mono"
        style={{ marginBottom: 8, color: 'var(--text-muted)' }}
      >
        {heading}
      </div>
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
        {tiles.map((t) => (
          <li key={t.href + t.label}>
            <Link
              href={t.href}
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
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
