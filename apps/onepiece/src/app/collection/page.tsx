import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@collector-network/auth';
import { listCollectionForCurrentUser } from '../../server/collection';
import { CollectionRowActions } from './CollectionRowActions';
import { canonicalFor } from '@/lib/seo';
import { buildPrintingSlug } from '@/lib/onepiece/slug';
import { pickCardImage } from '@/lib/onepiece/image';

export const metadata: Metadata = {
  title: 'My One Piece Collection',
  description: 'Your One Piece Card Game collection with live market value.',
  alternates: { canonical: canonicalFor('/collection') },
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function CollectionPage() {
  await requireUser('/collection');
  const result = await listCollectionForCurrentUser();

  if (!result.ok && result.reason === 'table-missing') {
    return (
      <main style={pageStyle}>
        <PageHeader />
        <div style={panelStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gold-600)', marginBottom: 6 }}>
            Schema pending
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)' }}>
            Collection storage is being provisioned for OnePiecePrices. This page will start working
            automatically once the shared-schema migration has been applied. Your account is unaffected —
            you can still browse cards, sets and market data in the meantime.
          </p>
        </div>
      </main>
    );
  }

  if (!result.ok) {
    return (
      <main style={pageStyle}>
        <PageHeader />
        <div style={{ ...panelStyle, borderColor: 'rgba(177,42,47,0.35)' }}>
          <p style={{ margin: 0, color: 'var(--text)' }}>
            Sorry — we couldn&apos;t load your collection right now. Reload the page in a moment.
          </p>
        </div>
      </main>
    );
  }

  const { items, summary } = result.value;

  return (
    <main style={pageStyle}>
      <PageHeader />

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatTile
          label="Current value"
          value={`$${summary.totalCurrentUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          hint={summary.missingPriceCount > 0 ? `USD · ${summary.missingPriceCount} unpriced` : 'USD'}
        />
        <StatTile
          label="Total copies"
          value={summary.totalCopies.toLocaleString()}
          hint={`${summary.uniqueHoldings} holdings · ${summary.uniqueCards} unique cards`}
        />
        <StatTile
          label="Raw / Graded"
          value={`${summary.rawCount} · ${summary.gradedCount}`}
          hint={`$${summary.rawValueUsd.toFixed(0)} raw · $${summary.gradedValueUsd.toFixed(0)} graded`}
        />
        <StatTile
          label="Realised P/L"
          value={
            summary.unrealisedUsd == null
              ? '—'
              : `${summary.unrealisedUsd >= 0 ? '+' : ''}$${summary.unrealisedUsd.toFixed(0)}`
          }
          hint={summary.unrealisedUsd == null ? 'Acquisition values incomplete' : 'vs USD acquisition'}
        />
      </section>

      {items.length === 0 ? (
        <div style={panelStyle}>
          <h2 style={{ margin: '0 0 6px', fontFamily: 'Outfit, system-ui, sans-serif', fontSize: 20 }}>
            Your collection is empty
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            Head to any card page and use the “Add to collection” control to start tracking your holdings.
            Raw, graded, quantity, condition and purchase price are all stored per holding.
          </p>
          <div style={{ marginTop: 12 }}>
            <Link
              href="/browse"
              style={{
                display: 'inline-block',
                padding: '9px 14px',
                borderRadius: 10,
                background: 'var(--gold-600)',
                color: '#111',
                fontSize: 13,
                fontWeight: 700,
                textDecoration: 'none',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Browse sets
            </Link>
          </div>
        </div>
      ) : (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))',
            gap: 14,
          }}
        >
          {items.map(({ row, card, printing, set, priced }) => {
            const image = card ? pickCardImage(card.images, 'small') : null;
            const cardName = card?.name ?? 'Unknown card';
            const collectorNumber = card?.collector_number ?? row.tcg_card_id;
            const setCode = set?.code?.toUpperCase() ?? '';
            const printingHref = card
              ? `/set/${encodeURIComponent((set?.code ?? '').toLowerCase())}/card/${encodeURIComponent(buildPrintingSlug(card.collector_number, card.name))}`
              : null;
            const priceLabel =
              priced.unitValueUsd != null
                ? `$${(priced.unitValueUsd * row.quantity).toFixed(2)}`
                : 'Unpriced';
            const priceHint =
              priced.valueUsdSource === 'printing-retail'
                ? 'Retail · this printing'
                : priced.valueUsdSource === 'printing-graded'
                ? `${row.grader?.toUpperCase() ?? ''} ${row.grade ?? ''} · this printing`
                : priced.valueUsdSource === 'card-graded-family'
                ? `${row.grader?.toUpperCase() ?? ''} ${row.grade ?? ''} · family estimate`
                : 'No market data on this basis';
            return (
              <article
                key={row.id}
                style={{
                  display: 'grid',
                  gap: 8,
                  padding: 12,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    aspectRatio: '5 / 7',
                    background: 'var(--bg-light)',
                    borderRadius: 8,
                    overflow: 'hidden',
                  }}
                >
                  {image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={image}
                      alt={cardName}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : null}
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.25 }}>
                  {printingHref ? (
                    <Link href={printingHref} style={{ color: 'var(--text)', textDecoration: 'none' }}>
                      {cardName}
                    </Link>
                  ) : (
                    cardName
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {setCode} · {collectorNumber}
                  {row.is_graded && row.grader && row.grade && (
                    <>
                      {' · '}
                      <span style={{ color: 'var(--gold-600)' }}>{row.grader.toUpperCase()} {row.grade}</span>
                    </>
                  )}
                  {!row.is_graded && row.condition && (
                    <>
                      {' · '}
                      {row.condition}
                    </>
                  )}
                  {printing?.finish && printing.finish !== 'nonfoil' && (
                    <>
                      {' · '}
                      {printing.finish}
                    </>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    marginTop: 4,
                  }}
                >
                  <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 16 }}>
                    {priceLabel}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>×{row.quantity}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{priceHint}</div>
                <CollectionRowActions id={row.id} />
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}

function PageHeader() {
  return (
    <header style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gold-600)' }}>Account · Collection</div>
      <h1 style={{ margin: '4px 0 4px', fontFamily: 'Outfit, system-ui, sans-serif', fontSize: 28, letterSpacing: '-0.01em' }}>
        Your One Piece collection
      </h1>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        Every holding valued against live production data. Raw cards priced from TCGplayer/Cardmarket
        retail, graded cards from the same PSA / BGS / CGC / SGC market data used on card pages.
      </p>
    </header>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 22, fontWeight: 800, color: 'var(--text-strong)', marginTop: 2 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 1180,
  margin: '0 auto',
  padding: '28px 24px 80px',
};

const panelStyle: React.CSSProperties = {
  padding: 20,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 14,
};
