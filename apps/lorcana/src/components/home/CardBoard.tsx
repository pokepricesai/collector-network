import Link from 'next/link';
import type { DiscoveryTile } from '@/server/discovery';
import { buildPrintingSlug, slugifyCardName } from '@/lib/lorcana/slug';
import { formatPrice } from '@/lib/lorcana/format-price';
import { normaliseRarity } from '@/lib/lorcana/rarity';

// Generic priced-card board — used by "Most valuable", "Enchanted
// spotlight", and per-set most-valuable panels. Renders a responsive
// grid of card tiles, each linking to its logical card page.
//
// When `variant='dark'` it renders inside a .lc-chase-panel container
// (Enchanted / Iconic spotlight).

interface CardBoardProps {
  tiles: DiscoveryTile[];
  emptyLabel?: string;
  columns?: 3 | 4 | 5 | 6;
  variant?: 'default' | 'dark';
  compact?: boolean;
}

export default function CardBoard({
  tiles,
  emptyLabel = 'No priced cards yet.',
  columns = 4,
  variant = 'default',
  compact = false,
}: CardBoardProps) {
  if (tiles.length === 0) {
    return (
      <div style={{
        padding: 20,
        textAlign: 'center',
        color: variant === 'dark' ? 'rgba(240,225,183,0.6)' : 'var(--text-muted)',
        fontSize: 13,
      }}>
        {emptyLabel}
      </div>
    );
  }

  const minColWidth = compact ? 120 : 150;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${minColWidth}px, 100%), 1fr))`,
        gap: compact ? 10 : 14,
      }}
    >
      {tiles.slice(0, columns * 3).map((t) => (
        <CardTile key={`${t.cardId}:${t.printingId}`} tile={t} variant={variant} compact={compact} />
      ))}
    </div>
  );
}

function CardTile({ tile, variant, compact }: { tile: DiscoveryTile; variant: 'default' | 'dark'; compact: boolean }) {
  const rarity = normaliseRarity(tile.rarity);
  // Route to the SPECIFIC tcg_cards row the tile represents (set × collector
  // number × rarity), not the logical /card/[slug] page. Multiple Lorcana
  // tcg_cards rows share a name — e.g. "Elsa - Ice Maker" has 4 rows across
  // sets 7 (SR, cn=224 Amethyst-ink alt-art; SR, cn=69) and c2 (Promo cn=2;
  // Promo cn=6). The logical page picks a hero by rarity so a Promo tile
  // used to land on the Super Rare hero image. The per-printing route
  // (/set/{code}/card/{cn-slug}) resolves to the exact tcg_cards row we
  // showed. When setCode + collectorNumber are missing (should be rare) we
  // fall back to the logical page to preserve navigability.
  const href = tile.setCode && tile.collectorNumber
    ? `/set/${encodeURIComponent(tile.setCode.toLowerCase())}/card/${encodeURIComponent(buildPrintingSlug(tile.collectorNumber, tile.name))}`
    : `/card/${encodeURIComponent(slugifyCardName(tile.name))}`;
  const isDark = variant === 'dark';

  return (
    <Link
      href={href}
      className="lc-tile lc-hover lc-hover-amethyst"
      data-rarity={tile.rarity ?? ''}
      style={{
        background: isDark ? 'rgba(255,255,255,0.04)' : undefined,
        borderColor: isDark ? 'rgba(240,225,183,0.14)' : undefined,
        color: isDark ? '#F0E1B7' : undefined,
      }}
    >
      <div className="lc-tile-art">
        {tile.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={tile.imageUrl} alt={tile.name} loading="lazy" />
        ) : (
          <div className="lc-tile-empty" aria-hidden />
        )}
      </div>
      <div style={{
        fontWeight: 700,
        fontSize: compact ? 12.5 : 13.5,
        lineHeight: 1.25,
        color: isDark ? '#F5E7B8' : 'var(--text-strong)',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {tile.name}
      </div>
      <div style={{
        display: 'flex',
        gap: 6,
        alignItems: 'baseline',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {tile.setCode && (
            <span className="label-mono" style={{
              color: isDark ? 'rgba(240,225,183,0.7)' : undefined,
            }}>
              {tile.setCode.toUpperCase()}
              {tile.collectorNumber ? ` · ${tile.collectorNumber}` : ''}
            </span>
          )}
        </div>
        <span className="lc-tile-price" style={{ color: isDark ? '#F5E7B8' : undefined }}>
          {formatPrice(tile.priceUsd, tile.priceCurrency)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {rarity.code !== 'UNKNOWN' && (
          <span className={`treatment-badge treatment-badge--${rarity.code.toLowerCase()}`}>
            {rarity.label}
          </span>
        )}
        {tile.finish === 'foil' && (
          <span className="treatment-badge treatment-badge--foil">Foil</span>
        )}
      </div>
    </Link>
  );
}
