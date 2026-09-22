import type { ReactNode } from 'react';
import { SearchBar } from '../SearchBar';
import { CardImageFrame } from '../CardImageFrame';
import { GradedPriceCell } from '../GradedPriceCell';
import { PrintingFingerprint } from '../PrintingFingerprint';
import { RarityBadge } from '../RarityBadge';
import { RarityRefractorLine } from '../signature/RarityRefractorLine';
import { Surface } from '../Surface';
import type {
  GradedHighlight,
  HomepagePayload,
  IconicCardFamily,
  LatestSet,
  MostValuablePrinting,
  RarityDiscoveryEntry,
} from '../../server/homepage';
import styles from './Sections.module.css';

interface SectionProps {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}

export function Section({ title, meta, children }: SectionProps) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {meta && <span className={styles.sectionMeta}>{meta}</span>}
      </header>
      {children}
    </section>
  );
}

// ── Hero ────────────────────────────────────────────────────────────

export function Hero() {
  return (
    <section className={styles.hero}>
      <p className={styles.eyebrow}>Yu-Gi-Oh! · collector database</p>
      <h1 className={styles.heroTitle}>
        Find the exact Yu-Gi-Oh!&nbsp;card you own.
      </h1>
      <p className={styles.heroSub}>
        Compare every printing, edition, and rarity. See raw prices and
        graded values side by side. Search by name, set code, or archetype.
      </p>
      <div className={styles.heroSearch}>
        <SearchBar size="lg" autoFocus placeholder="e.g. Blue-Eyes White Dragon, LOB-001, Sky Striker" />
        <div className={styles.heroExamples}>
          <span>try</span>
          <span className={styles.heroExample}>blue-eyes</span>
          <span className={styles.heroExample}>LOB-001</span>
          <span className={styles.heroExample}>ghost rare</span>
          <span className={styles.heroExample}>sky striker</span>
        </div>
      </div>
    </section>
  );
}

// ── Iconic cards ────────────────────────────────────────────────────

export function IconicCards({ families }: { families: IconicCardFamily[] }) {
  if (families.length === 0) return null;
  return (
    <Section
      title="Iconic families"
      meta={<>{families.length} families · live from the shared catalogue</>}
    >
      <div className={styles.grid}>
        {families.map((f) => (
          <IconicTile key={f.name} family={f} />
        ))}
      </div>
    </Section>
  );
}

function IconicTile({ family }: { family: IconicCardFamily }) {
  return (
    <Surface variant="card" className={styles.iconicTile}>
      <div className={styles.iconicImageWrap}>
        <CardImageFrame
          src={family.representativeImage}
          alt={family.name}
          rarity={family.rarityRange[0]}
          maxWidth={160}
        />
      </div>
      <h3 className={styles.iconicName}>{family.name}</h3>
      <RarityRefractorLine rarity={family.rarityRange[0]} />
      <div className={styles.iconicMeta}>
        <span>{family.totalPrintings} printings</span>
        {family.rarityRange.length > 0 && (
          <span>{family.rarityRange.length} rarities</span>
        )}
      </div>
      {family.usdPriceLow != null && family.usdPriceHigh != null && (
        <div>
          <span className={styles.iconicPrice}>
            ${family.usdPriceLow.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            {family.usdPriceHigh > family.usdPriceLow &&
              ` – $${family.usdPriceHigh.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          </span>
          <span className={styles.iconicPriceSuffix}>USD · retail range</span>
        </div>
      )}
    </Surface>
  );
}

// ── Most valuable (movers fallback) ────────────────────────────────

export function MostValuable({ items }: { items: MostValuablePrinting[] }) {
  if (items.length === 0) return null;
  return (
    <Section
      title="Most valuable printings today"
      meta={
        <>
          Highest retail prices (USD). Full 24-hour / 7-day movement
          returns once daily-snapshot history matures.
        </>
      }
    >
      <div className={styles.wideGrid}>
        {items.map((item) => (
          <Surface
            key={item.printing?.id ?? item.quote.printingId}
            variant="market"
            className={styles.mostValuableTile}
          >
            <div className={styles.mostValuableImageWrap}>
              <CardImageFrame
                src={item.card?.images?.small ?? null}
                alt={item.card?.name ?? 'Card image'}
                rarity={item.card?.rarity}
                maxWidth={60}
                gloss={false}
              />
            </div>
            <div>
              <p className={styles.mostValuableName}>
                {item.card?.name ?? '(unknown card)'}
              </p>
              {item.printing && (
                <PrintingFingerprint
                  collectorNumber={item.printing.collector_number}
                  rarity={item.card?.rarity}
                  edition={item.printing.edition}
                  language={item.printing.language}
                />
              )}
              <div style={{ marginTop: 6 }}>
                <span className={styles.mostValuablePrice}>
                  ${item.quote.price?.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </span>
                <span className={styles.mostValuablePriceCurrency}>
                  {item.quote.currency} · {item.quote.source.split('.').pop()}
                </span>
              </div>
            </div>
          </Surface>
        ))}
      </div>
    </Section>
  );
}

// ── Latest sets ────────────────────────────────────────────────────

export function LatestSets({ sets }: { sets: LatestSet[] }) {
  if (sets.length === 0) return null;
  return (
    <Section
      title="Latest sets"
      meta={<>Detail pages arrive in a later slice.</>}
    >
      <div className={styles.grid}>
        {sets.map((entry) => (
          <Surface key={entry.set.id} variant="card" className={styles.setTile}>
            <h3 className={styles.setName}>{entry.set.name}</h3>
            <div className={styles.setMetaRow}>
              <span className={styles.setCode}>
                {entry.set.code.toUpperCase()}
              </span>
              {entry.set.released_at && (
                <span>
                  released{' '}
                  {new Date(entry.set.released_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              )}
            </div>
            {entry.cardCount != null && entry.cardCount > 0 && (
              <div className={styles.setMetaRow}>
                <span>{entry.cardCount} cards indexed</span>
              </div>
            )}
          </Surface>
        ))}
      </div>
    </Section>
  );
}

// ── Graded highlights ──────────────────────────────────────────────

export function GradedHighlights({ items }: { items: GradedHighlight[] }) {
  if (items.length === 0) {
    return (
      <Section title="Graded highlights">
        <p className={styles.notice}>
          Graded 1st-Edition slabs load into this section as they
          refresh. Vintage graded pricing is held back pending an ingest
          correction — see the site data notes for the reason.
        </p>
      </Section>
    );
  }
  return (
    <Section
      title="Graded highlights"
      meta={<>Grade 10 · 1st Edition printings only · never raw · USD.</>}
    >
      <div className={styles.wideGrid}>
        {items.map((h) => (
          <Surface
            key={h.printing.id + h.quote.grader}
            variant="premium"
            className={styles.gradedTile}
          >
            <div className={styles.gradedTileHead}>
              <div className={styles.gradedTileImage}>
                <CardImageFrame
                  src={h.card.images?.small ?? null}
                  alt={h.card.name}
                  rarity={h.card.rarity}
                  maxWidth={72}
                  gloss={false}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 className={styles.gradedTileName}>{h.card.name}</h3>
                <div style={{ marginTop: 4 }}>
                  <RarityBadge rarity={h.card.rarity} />
                </div>
              </div>
            </div>
            <PrintingFingerprint
              collectorNumber={h.printing.collector_number}
              rarity={h.card.rarity}
              edition={h.printing.edition}
              language={h.printing.language}
            />
            <div>
              <GradedPriceCell
                grader={h.quote.grader}
                grade={h.quote.grade}
                price={h.quote.price}
                currency={h.quote.currency}
                cardSalesVolume={h.quote.cardSalesVolume}
              />
            </div>
          </Surface>
        ))}
      </div>
    </Section>
  );
}

// ── Rarity discovery ───────────────────────────────────────────────

export function RarityDiscovery({ entries }: { entries: RarityDiscoveryEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <Section title="Discover by rarity">
      <div className={styles.grid}>
        {entries.map((entry) => (
          <Surface key={entry.rarity} variant="card" className={styles.rarityTile}>
            <div className={styles.rarityLabel}>
              <RarityBadge rarity={entry.rarity} showDot size="lg" />
              <span
                style={{
                  fontFamily: 'var(--ygo-font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 12,
                  color: 'var(--ygo-text-muted)',
                }}
              >
                {entry.totalCards.toLocaleString('en-US')} cards
              </span>
            </div>
            <RarityRefractorLine rarity={entry.rarity} />
            <p className={styles.raritySample}>
              {entry.exampleCards.slice(0, 3).map((c, i) => (
                <span key={i}>
                  {i > 0 ? ' · ' : ''}
                  {c.name}
                </span>
              ))}
            </p>
          </Surface>
        ))}
      </div>
    </Section>
  );
}

// ── Data notes ─────────────────────────────────────────────────────

export function DataNotes({ payload }: { payload: HomepagePayload }) {
  return (
    <Section title="Data + freshness">
      <p className={styles.notice}>
        Live from production catalogue · fetched{' '}
        {new Date(payload.fetchedAt).toLocaleString('en-US')}. Card
        images are cached by TCGGraph. Retail prices refresh through
        TCGplayer and Cardmarket ingest. Graded values come from public
        grader and marketplace observations. Currency is never converted
        — USD and EUR are shown as-is.
      </p>
      <p className={styles.notice} style={{ marginTop: 8 }}>
        Forbidden &amp; Limited snapshot, full card pages, and set/
        archetype browsing are being built in the next slices. The
        &ldquo;soon&rdquo; navigation labels above light up as each
        surface ships.
      </p>
      {payload.errors.length > 0 && (
        <details
          style={{
            marginTop: 12,
            fontFamily: 'var(--ygo-font-mono)',
            fontSize: 11,
            color: 'var(--ygo-text-quiet)',
          }}
        >
          <summary>Section-fetch errors ({payload.errors.length})</summary>
          <ul>
            {payload.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

// ── Page shell ─────────────────────────────────────────────────────

export function HomepageShell({ children }: { children: ReactNode }) {
  return <main className={styles.page}>{children}</main>;
}
