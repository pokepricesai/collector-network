import Link from 'next/link';
import type { OpSetMarket, OpSetTile } from '@/server/set-market';
import { SET_VALUE_COVERAGE_THRESHOLD } from '@/server/set-market';
import { buildPrintingSlug } from '@/lib/onepiece/slug';

interface Props {
  market: OpSetMarket;
  setCode: string;
  setName: string;
}

function fmt(price: number): string {
  return price.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function coverageLabel(priced: number, eligible: number): string {
  if (eligible <= 0) return '0%';
  if (priced <= 0) return '0%';
  if (priced >= eligible) return '100%';
  return `${((priced / eligible) * 100).toFixed(1)}%`;
}

export function SetMarketOverview({ market, setCode, setName }: Props) {
  if (market.pricedCount === 0) return null;
  const showsFullValue = market.coverage >= SET_VALUE_COVERAGE_THRESHOLD;
  const valueLabel = showsFullValue ? 'Set value' : 'Priced-card subtotal';
  const valueSublabel = showsFullValue
    ? 'Estimated set value from cheapest-USD-per-card retail across every priced printing.'
    : `Subtotal for the ${market.pricedCount.toLocaleString()} priced cards. Coverage is below ${Math.round(SET_VALUE_COVERAGE_THRESHOLD * 100)}%, so this is not a whole-set estimate.`;

  return (
    <section
      aria-label={`${setName} market overview`}
      style={{
        marginBottom: 24,
        padding: 20,
        background:
          'linear-gradient(180deg, rgba(232,169,75,0.05) 0%, rgba(232,169,75,0) 60%), var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        boxShadow: '0 3px 12px rgba(20,33,61,0.04)',
      }}
    >
      <div className="label-mono" style={{ color: 'var(--gold-600)', marginBottom: 8 }}>
        Set market overview
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 24,
          alignItems: 'baseline',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              marginBottom: 2,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
            }}
          >
            {valueLabel}
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 800,
              fontFamily: 'ui-monospace, monospace',
              color: 'var(--text-strong)',
            }}
          >
            {fmt(market.subtotalUsd)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, maxWidth: 460, lineHeight: 1.4 }}>
            {valueSublabel}
          </div>
        </div>
        <MiniStat
          label="Priced cards"
          value={`${market.pricedCount} / ${market.eligibleCount}`}
          sub={`${coverageLabel(market.pricedCount, market.eligibleCount)} coverage`}
        />
        <MiniStat
          label="Unpriced"
          value={String(Math.max(0, market.eligibleCount - market.pricedCount))}
          sub="No USD retail on any printing yet"
        />
      </div>

      <details style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Methodology</summary>
        <p style={{ margin: '6px 0 0', lineHeight: 1.55 }}>
          For each unique card in this set we take the cheapest current USD retail across all its
          printings and sum those numbers. Foil premiums are deliberately excluded to keep the total
          comparable across sets. Cards with no current USD retail on any printing are counted as
          unpriced and reported separately.
        </p>
      </details>

      <div
        style={{
          marginTop: 20,
          display: 'grid',
          gap: 14,
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        }}
      >
        <Panel title="Most valuable">
          {market.mostValuable.map((t) => (
            <TileRow key={t.printingId} tile={t} setCode={setCode} />
          ))}
        </Panel>
        {market.cheapest.length > 0 && market.mostValuable.length > 0 && (
          <Panel title="Cheapest">
            {market.cheapest.map((t) => (
              <TileRow key={t.printingId} tile={t} setCode={setCode} />
            ))}
          </Panel>
        )}
      </div>

      <p
        style={{
          margin: '14px 0 0',
          fontSize: 11,
          color: 'var(--text-muted)',
          fontStyle: 'italic',
        }}
      >
        {market.historyWindowNote}
      </p>
    </section>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="label-mono">{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-strong)', fontFamily: 'ui-monospace, monospace' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-light)' }}>
      <div className="label-mono" style={{ color: 'var(--gold-600)', marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>{children}</div>
    </div>
  );
}

function TileRow({ tile, setCode }: { tile: OpSetTile; setCode: string }) {
  const href = `/set/${encodeURIComponent(setCode.toLowerCase())}/card/${encodeURIComponent(buildPrintingSlug(tile.collectorNumber, tile.name))}`;
  return (
    <Link
      href={href}
      style={{
        display: 'grid',
        gridTemplateColumns: '48px 1fr auto',
        gap: 10,
        alignItems: 'center',
        padding: '6px 4px',
        borderRadius: 8,
        color: 'var(--text)',
        textDecoration: 'none',
      }}
    >
      <div
        style={{
          width: 48,
          height: 64,
          borderRadius: 6,
          background: 'var(--surface)',
          overflow: 'hidden',
          border: '1px solid var(--border)',
        }}
      >
        {tile.imageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={tile.imageUrl} alt={tile.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {tile.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          #{tile.collectorNumber ?? '—'} · {tile.rarity ?? ''}
        </div>
      </div>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 14, fontWeight: 700, color: 'var(--text-strong)' }}>
        {fmt(tile.priceUsd)}
      </div>
    </Link>
  );
}
