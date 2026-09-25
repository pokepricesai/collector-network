// Shared read-only deck presentation for /deck/[slug] and
// /deck/share/[token]. No writes, no owner controls. Reuses the
// same legality + stats + valuation the private builder uses.

import Image from 'next/image';
import Link from 'next/link';
import {
  frameLabel,
  isMonsterFrame,
  type Section,
} from '../../lib/deck-identity';
import type { PublicDeckView } from '../../server/deck-publishing';
import { ShareBar } from './ShareBar';
import styles from './SharedDeckRenderer.module.css';

interface Props {
  deck: PublicDeckView;
  // Copy-CTA payload — kind decides which server action fires.
  copySource:
    | { kind: 'public'; slug: string }
    | { kind: 'unlisted'; token: string };
  copyError?: string | null;
  // Optional external heading (unlisted route adds a subtle "shared
  // via unlisted link" note).
  contextNote?: React.ReactNode;
  // Precomputed public URL (for the Copy-link button when public).
  publicUrl?: string | null;
  // Precomputed share URL for unlisted variant.
  shareUrl?: string | null;
}

export function SharedDeckRenderer({
  deck,
  copySource,
  copyError,
  contextNote,
  publicUrl,
  shareUrl,
}: Props) {
  const state = deck.legality.state;
  const stateCls =
    state === 'legal'
      ? styles.stateLegal
      : state === 'incomplete'
      ? styles.stateIncomplete
      : styles.stateIllegal;

  const grouped = { main: [] as PublicDeckView['cards'], extra: [] as PublicDeckView['cards'], side: [] as PublicDeckView['cards'] };
  for (const c of deck.cards) grouped[c.row.section].push(c);
  for (const s of ['main', 'extra', 'side'] as const)
    grouped[s].sort((a, b) => a.row.card_name.localeCompare(b.row.card_name));

  const totalCopies = grouped.main.reduce((n, c) => n + c.row.quantity, 0)
    + grouped.extra.reduce((n, c) => n + c.row.quantity, 0)
    + grouped.side.reduce((n, c) => n + c.row.quantity, 0);

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{deck.name}</h1>
          {contextNote && <p className={styles.subtitle}>{contextNote}</p>}
          {deck.description && (
            <p className={styles.description}>{deck.description}</p>
          )}
          <div className={styles.metaRow}>
            <span className={`${styles.stateBadge} ${stateCls}`}>{state}</span>
            <span
              className={`${styles.visPill} ${
                deck.visibility === 'public'
                  ? styles.visPublic
                  : deck.visibility === 'unlisted'
                  ? styles.visUnlisted
                  : ''
              }`}
            >
              {deck.visibility}
            </span>
            <span>{totalCopies} cards</span>
            <span>·</span>
            <span>updated {formatDate(deck.updatedAt)}</span>
            {deck.publishedAt && (
              <>
                <span>·</span>
                <span>published {formatDate(deck.publishedAt)}</span>
              </>
            )}
          </div>
          {copyError && (
            <div className={styles.error} role="alert">
              {copyError}
            </div>
          )}
        </div>
        <ShareBar
          copySource={copySource}
          publicUrl={publicUrl ?? null}
          shareUrl={shareUrl ?? null}
        />
      </header>

      <div className={styles.body}>
        <div className={styles.sections}>
          <SectionBlock
            title="Main Deck"
            limitLabel="40–60"
            count={deck.legality.counts.main}
            cards={grouped.main}
            section="main"
          />
          <SectionBlock
            title="Extra Deck"
            limitLabel="0–15"
            count={deck.legality.counts.extra}
            cards={grouped.extra}
            section="extra"
          />
          <SectionBlock
            title="Side Deck"
            limitLabel="0–15"
            count={deck.legality.counts.side}
            cards={grouped.side}
            section="side"
          />
        </div>
        <aside className={styles.sidebar}>
          <LegalityCard deck={deck} />
          <StatsCard deck={deck} />
          <ValueCard deck={deck} />
        </aside>
      </div>
    </div>
  );
}

function SectionBlock({
  title,
  limitLabel,
  count,
  cards,
  section,
}: {
  title: string;
  limitLabel: string;
  count: number;
  cards: PublicDeckView['cards'];
  section: Section;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <span className={styles.sectionMeta}>
          {count} card{count === 1 ? '' : 's'} · {limitLabel}
        </span>
      </header>
      {cards.length === 0 ? (
        <div className={styles.emptySection}>Empty.</div>
      ) : (
        <div className={styles.cardGrid}>
          {cards.flatMap((c) => {
            // Render one tile per copy so the grid mirrors a physical
            // deck. Small grid means 3× tiles for a Ryzeal is fine
            // visually.
            const cardTiles: React.ReactNode[] = [];
            for (let i = 0; i < c.row.quantity; i++) {
              cardTiles.push(<CardTile key={`${c.row.id}-${i}`} card={c} showQty={i === 0} sectionKey={section} />);
            }
            return cardTiles;
          })}
        </div>
      )}
    </section>
  );
}

function CardTile({
  card,
  showQty,
  sectionKey,
}: {
  card: PublicDeckView['cards'][number];
  showQty: boolean;
  sectionKey: Section;
}) {
  void sectionKey;
  const img =
    card.preferredPrinting == null
      ? card.representative?.images?.small ??
        card.representative?.images?.normal ??
        card.representative?.images?.large ??
        null
      : card.representative?.images?.small ??
        card.representative?.images?.normal ??
        null;
  const fnl = card.fnlStatus;
  const fnlCls =
    fnl === 'forbidden'
      ? styles.fnlForbidden
      : fnl === 'limited'
      ? styles.fnlLimited
      : fnl === 'semi-limited'
      ? styles.fnlSemi
      : '';
  const fnlLabel =
    fnl === 'forbidden' ? 'F' : fnl === 'limited' ? 'L' : fnl === 'semi-limited' ? 'SL' : '';
  return (
    <div className={styles.cardTile} title={card.row.card_name}>
      {img ? (
        <Image src={img} alt={card.row.card_name} className={styles.cardImg} width={90} height={126} unoptimized />
      ) : (
        <div className={styles.cardLabel}>{card.row.card_name}</div>
      )}
      {fnl !== 'unlimited' && <span className={`${styles.fnlBadge} ${fnlCls}`}>{fnlLabel}</span>}
      {showQty && <span className={styles.qtyBadge}>×{card.row.quantity}</span>}
    </div>
  );
}

function LegalityCard({ deck }: { deck: PublicDeckView }) {
  const state = deck.legality.state;
  const label = state === 'legal' ? 'Legal' : state === 'incomplete' ? 'Incomplete' : 'Illegal';
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>Legality · {label}</h3>
      {deck.legality.issues.length === 0 ? (
        <div className={styles.legalityAllGood}>
          Every rule checks out - evaluated against the current TCG F&amp;L data.
        </div>
      ) : (
        <div className={styles.legalityIssues}>
          {deck.legality.issues.map((i, idx) => (
            <div
              key={idx}
              className={`${styles.issue} ${i.severity === 'error' ? styles.issueError : styles.issueInfo}`}
            >
              {i.message}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StatsCard({ deck }: { deck: PublicDeckView }) {
  const stats = computeStats(deck.cards);
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>Deck stats</h3>
      <div>
        <div className={styles.statRow}><span className={styles.statKey}>Monsters</span><span className={styles.statValue}>{stats.monsters}</span></div>
        <div className={styles.statRow}><span className={styles.statKey}>Spells</span><span className={styles.statValue}>{stats.spells}</span></div>
        <div className={styles.statRow}><span className={styles.statKey}>Traps</span><span className={styles.statValue}>{stats.traps}</span></div>
        {stats.mainMonsterLevelAvg != null && (
          <div className={styles.statRow}>
            <span className={styles.statKey}>Avg monster level (main)</span>
            <span className={styles.statValue}>{stats.mainMonsterLevelAvg.toFixed(1)}</span>
          </div>
        )}
        {stats.attributes.length > 0 && (
          <div className={styles.statRow}>
            <span className={styles.statKey}>Attributes</span>
            <span className={styles.statValue}>
              {stats.attributes.map((a) => `${a.name}×${a.count}`).join(' · ')}
            </span>
          </div>
        )}
        {stats.races.length > 0 && (
          <div className={styles.statRow}>
            <span className={styles.statKey}>Top types</span>
            <span className={styles.statValue}>
              {stats.races.map((r) => `${r.name}×${r.count}`).join(' · ')}
            </span>
          </div>
        )}
        {stats.extraBreakdown.length > 0 && (
          <div className={styles.statRow}>
            <span className={styles.statKey}>Extra breakdown</span>
            <span className={styles.statValue}>
              {stats.extraBreakdown.map((e) => `${e.name}×${e.count}`).join(' · ')}
            </span>
          </div>
        )}
        {stats.archetypes.length > 0 && (
          <div className={styles.statRow}>
            <span className={styles.statKey}>Archetypes</span>
            <span className={styles.statValue}>
              {stats.archetypes.slice(0, 4).map((a) => a.name).join(' · ')}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function ValueCard({ deck }: { deck: PublicDeckView }) {
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>Estimated value</h3>
      {deck.totalValueUsd > 0 ? (
        <>
          <div className={styles.valueTotal}>
            ${deck.totalValueUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </div>
          <div className={styles.valueRow}>
            <span>Main</span>
            <span>${deck.mainValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
          </div>
          <div className={styles.valueRow}>
            <span>Extra</span>
            <span>${deck.extraValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
          </div>
          <div className={styles.valueRow}>
            <span>Side</span>
            <span>${deck.sideValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
          </div>
          {deck.missingPriceCount > 0 && (
            <div className={styles.valueMuted}>
              {deck.missingPriceCount} card{deck.missingPriceCount === 1 ? '' : 's'} without a current market price - excluded from totals.
            </div>
          )}
        </>
      ) : (
        <div className={styles.valueMuted}>
          No priced cards yet. Values use printing-scoped USD retail.
        </div>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface Stats {
  monsters: number;
  spells: number;
  traps: number;
  mainMonsterLevelAvg: number | null;
  attributes: Array<{ name: string; count: number }>;
  races: Array<{ name: string; count: number }>;
  extraBreakdown: Array<{ name: string; count: number }>;
  archetypes: Array<{ name: string; count: number }>;
}

function computeStats(cards: PublicDeckView['cards']): Stats {
  let monsters = 0;
  let spells = 0;
  let traps = 0;
  const mainMonsterLevels: number[] = [];
  const attrCounter = new Map<string, number>();
  const raceCounter = new Map<string, number>();
  const extraCounter = new Map<string, number>();
  const archCounter = new Map<string, number>();
  for (const c of cards) {
    const q = c.row.quantity;
    const ft = c.frameType;
    if (ft === 'spell') spells += q;
    else if (ft === 'trap') traps += q;
    else monsters += q;
    if (c.row.section === 'main' && ft !== 'spell' && ft !== 'trap') {
      const level = (c.representative?.gamedata as { level?: number } | null | undefined)?.level;
      if (typeof level === 'number') for (let i = 0; i < q; i++) mainMonsterLevels.push(level);
    }
    if (isMonsterFrame(ft)) {
      const attr = (c.representative?.gamedata as { attribute?: string } | null | undefined)?.attribute;
      if (typeof attr === 'string') attrCounter.set(attr, (attrCounter.get(attr) ?? 0) + q);
      const race = (c.representative?.gamedata as { race?: string } | null | undefined)?.race;
      if (typeof race === 'string') raceCounter.set(race, (raceCounter.get(race) ?? 0) + q);
    }
    if (c.row.section === 'extra') {
      const label = frameLabel(ft).replace(' Monster', '');
      extraCounter.set(label, (extraCounter.get(label) ?? 0) + q);
    }
    const archs = (c.representative?.gamedata as { archetypes?: string[] } | null | undefined)?.archetypes;
    if (Array.isArray(archs)) for (const a of archs) archCounter.set(a, (archCounter.get(a) ?? 0) + q);
  }
  return {
    monsters,
    spells,
    traps,
    mainMonsterLevelAvg:
      mainMonsterLevels.length > 0
        ? mainMonsterLevels.reduce((n, v) => n + v, 0) / mainMonsterLevels.length
        : null,
    attributes: [...attrCounter.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    races: [...raceCounter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, count]) => ({ name, count })),
    extraBreakdown: [...extraCounter.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    archetypes: [...archCounter.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  };
}
// (Link import isn't used yet — kept for future related-decks widget.)
void Link;
