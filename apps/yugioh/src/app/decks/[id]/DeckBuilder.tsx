'use client';

// Yu-Gi-Oh deck builder.
//
// Three columns on desktop:
//   1. Card search (typeahead + frame filter + one-click add)
//   2. Main / Extra / Side sections with inline quantity controls
//   3. Legality panel + deck stats + estimated value
//
// Stacks to a single column on mobile. Quantity mutations are
// server-round-trip actions; the client optimistically updates but
// the server-side legality engine is authoritative (Invariants I3/I4).
//
// Deck name is inline-editable with a debounced rename call.

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  frameLabel,
  isMonsterFrame,
  type Section,
} from '../../../lib/deck-identity';
import type {
  DeckCardHydrated,
  DeckDetail,
} from '../../../server/decks';
import type { DeckSearchResult } from '../../../server/deck-search';
import type { LegalityResult } from '../../../lib/deck-legality';
import {
  renameDeckAction,
  upsertDeckCardAction,
} from '../actions';
import { searchDeckCardsAction } from './search-action';
import styles from './DeckBuilder.module.css';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Props { detail: DeckDetail; }

export function DeckBuilder({ detail }: Props) {
  const router = useRouter();
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [nameDraft, setNameDraft] = useState(detail.deck.name);
  const [pending, startTransition] = useTransition();

  // Rename with a 600ms debounce so the user doesn't get a save
  // round-trip on every keystroke.
  useEffect(() => {
    if (nameDraft === detail.deck.name) return;
    setSaveState('saving');
    const handle = setTimeout(() => {
      startTransition(async () => {
        const r = await renameDeckAction(detail.deck.id, { name: nameDraft });
        if (r.ok) {
          setSaveState('saved');
          router.refresh();
        } else {
          setSaveState('error');
        }
      });
    }, 600);
    return () => clearTimeout(handle);
  }, [nameDraft, detail.deck.name, detail.deck.id, router]);

  async function mutate(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setSaveState('saving');
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        setSaveState('saved');
        router.refresh();
      } else {
        setSaveState('error');
        // A brief window so the user notices; the next successful
        // mutation clears it.
      }
    });
  }

  return (
    <>
      <div className={styles.deckToolbar}>
        <Link href="/decks" className={styles.backLink}>← All decks</Link>
        <div className={styles.deckToolbarLeft}>
          <input
            className={styles.deckNameInput}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            aria-label="Deck name"
            maxLength={120}
          />
          <span className={styles.deckMetaLine}>
            format {detail.deck.format.toUpperCase()} · updated{' '}
            {new Date(detail.deck.updated_at).toLocaleString('en-US')}
          </span>
        </div>
        <SaveIndicator state={saveState} pending={pending} />
      </div>

      <div className={styles.wrap}>
        <SearchPanel
          onAdd={(res, section) =>
            mutate(() =>
              upsertDeckCardAction(detail.deck.id, {
                card_name: res.card_name,
                section,
                deltaQty: 1,
              }),
            )
          }
        />
        <SectionsCol
          detail={detail}
          onDelta={(row, delta) =>
            mutate(() =>
              upsertDeckCardAction(detail.deck.id, {
                card_name: row.card_name,
                section: row.section,
                deltaQty: delta,
              }),
            )
          }
          onMove={(row, target) =>
            mutate(async () => {
              // Move = subtract one from source, add one to target.
              // Two round-trips; the DB stays consistent because
              // both writes are RLS-scoped and either can be rolled
              // back by the user retrying.
              const rem = await upsertDeckCardAction(detail.deck.id, {
                card_name: row.card_name,
                section: row.section,
                deltaQty: -1,
              });
              if (!rem.ok) return rem;
              return upsertDeckCardAction(detail.deck.id, {
                card_name: row.card_name,
                section: target,
                deltaQty: 1,
              });
            })
          }
        />
        <SidePanel detail={detail} />
      </div>
    </>
  );
}

function SaveIndicator({ state, pending }: { state: SaveState; pending: boolean }) {
  const label =
    pending || state === 'saving'
      ? 'Saving…'
      : state === 'saved'
      ? 'Saved'
      : state === 'error'
      ? 'Save failed — retry'
      : 'Saved';
  const cls =
    pending || state === 'saving'
      ? styles.saveStateSaving
      : state === 'error'
      ? styles.saveStateError
      : '';
  return <span className={`${styles.saveState} ${cls}`}>{label}</span>;
}

// ── Search panel ──────────────────────────────────────────

function SearchPanel({
  onAdd,
}: {
  onAdd: (res: DeckSearchResult, section: Section) => void;
}) {
  const [text, setText] = useState('');
  const [frame, setFrame] = useState<string | null>(null);
  const [results, setResults] = useState<DeckSearchResult[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Debounce search 250ms.
    const handle = setTimeout(async () => {
      if (!text.trim() && !frame) {
        setResults([]);
        return;
      }
      setBusy(true);
      const r = await searchDeckCardsAction({
        text: text.trim() || undefined,
        frame: frame ?? undefined,
        limit: 30,
      });
      setBusy(false);
      if (r.ok && r.results) setResults(r.results);
    }, 250);
    return () => clearTimeout(handle);
  }, [text, frame]);

  const frameFilters: Array<{ key: string | null; label: string }> = [
    { key: null, label: 'All' },
    { key: 'effect', label: 'Effect' },
    { key: 'normal', label: 'Normal' },
    { key: 'spell', label: 'Spell' },
    { key: 'trap', label: 'Trap' },
    { key: 'ritual', label: 'Ritual' },
    { key: 'fusion', label: 'Fusion' },
    { key: 'synchro', label: 'Synchro' },
    { key: 'xyz', label: 'Xyz' },
    { key: 'link', label: 'Link' },
  ];

  return (
    <aside className={styles.searchPanel}>
      <div className={styles.searchInputRow}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search cards by name…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className={styles.filterRow}>
        {frameFilters.map((f) => (
          <button
            key={f.label}
            type="button"
            className={`${styles.filterPill} ${f.key === frame ? styles.filterPillActive : ''}`}
            onClick={() => setFrame(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className={styles.searchResults}>
        {busy && results.length === 0 && (
          <div className={styles.emptySection}>Searching…</div>
        )}
        {!busy && results.length === 0 && text.length > 0 && (
          <div className={styles.emptySection}>No cards match.</div>
        )}
        {!busy && results.length === 0 && text.length === 0 && !frame && (
          <div className={styles.emptySection}>
            Type a card name or pick a frame filter to start.
          </div>
        )}
        {results.map((r) => (
          <SearchResultRow key={r.card_key} res={r} onAdd={onAdd} />
        ))}
      </div>
    </aside>
  );
}

function SearchResultRow({
  res,
  onAdd,
}: {
  res: DeckSearchResult;
  onAdd: (res: DeckSearchResult, section: Section) => void;
}) {
  const extra = res.frameType === 'fusion' || res.frameType === 'synchro' || res.frameType === 'xyz' || res.frameType === 'link';
  const defaultSection: Section = extra ? 'extra' : 'main';
  return (
    <div className={styles.resultRow}>
      {res.image ? (
        <Image src={res.image} alt="" width={40} height={56} className={styles.resultThumb} unoptimized />
      ) : (
        <div className={styles.resultThumb} aria-hidden />
      )}
      <div className={styles.resultBody}>
        <div className={styles.resultName}>{res.card_name}</div>
        <div className={styles.resultMeta}>
          {frameLabel(res.frameType)}
          {isMonsterFrame(res.frameType) && res.attribute ? ` · ${res.attribute}` : ''}
          {res.level != null ? ` · L${res.level}` : ''}
          {res.linkRating != null ? ` · Link-${res.linkRating}` : ''}
          {res.atk != null && res.def != null ? ` · ${res.atk}/${res.def}` : ''}
          {res.fnlStatus !== 'unlimited' && <FnlPill status={res.fnlStatus} />}
        </div>
      </div>
      <div className={styles.resultAddCol}>
        <button
          type="button"
          className={styles.addBtn}
          disabled={res.fnlStatus === 'forbidden'}
          onClick={() => onAdd(res, defaultSection)}
          title={
            res.fnlStatus === 'forbidden'
              ? 'This card is Forbidden and cannot be played.'
              : `Add to ${defaultSection === 'extra' ? 'Extra' : 'Main'}`
          }
        >
          + {defaultSection === 'extra' ? 'Extra' : 'Main'}
        </button>
        <button
          type="button"
          className={styles.addBtn}
          disabled={res.fnlStatus === 'forbidden'}
          onClick={() => onAdd(res, 'side')}
          title="Add to Side"
        >
          + Side
        </button>
      </div>
    </div>
  );
}

function FnlPill({ status }: { status: string }) {
  const cls =
    status === 'forbidden'
      ? styles.fnlForbidden
      : status === 'limited'
      ? styles.fnlLimited
      : status === 'semi-limited'
      ? styles.fnlSemi
      : '';
  const label =
    status === 'forbidden'
      ? 'Forbidden'
      : status === 'limited'
      ? 'Limited'
      : 'Semi-Ltd';
  return <span className={`${styles.fnlPill} ${cls}`}>{label}</span>;
}

// ── Sections column ───────────────────────────────────────

function SectionsCol({
  detail,
  onDelta,
  onMove,
}: {
  detail: DeckDetail;
  onDelta: (row: DeckCardHydrated['row'], delta: number) => void;
  onMove: (row: DeckCardHydrated['row'], target: Section) => void;
}) {
  const grouped = useMemo(() => {
    const g = { main: [] as DeckCardHydrated[], extra: [] as DeckCardHydrated[], side: [] as DeckCardHydrated[] };
    for (const c of detail.cards) g[c.row.section].push(c);
    for (const s of ['main', 'extra', 'side'] as const)
      g[s].sort((a, b) => a.row.card_name.localeCompare(b.row.card_name));
    return g;
  }, [detail.cards]);

  return (
    <div className={styles.sectionsCol}>
      <SectionColumn
        title="Main Deck"
        limitLabel="40–60"
        count={detail.legality.counts.main}
        cards={grouped.main}
        section="main"
        onDelta={onDelta}
        onMove={onMove}
      />
      <SectionColumn
        title="Extra Deck"
        limitLabel="0–15"
        count={detail.legality.counts.extra}
        cards={grouped.extra}
        section="extra"
        onDelta={onDelta}
        onMove={onMove}
      />
      <SectionColumn
        title="Side Deck"
        limitLabel="0–15"
        count={detail.legality.counts.side}
        cards={grouped.side}
        section="side"
        onDelta={onDelta}
        onMove={onMove}
      />
    </div>
  );
}

function SectionColumn({
  title,
  limitLabel,
  count,
  cards,
  section,
  onDelta,
  onMove,
}: {
  title: string;
  limitLabel: string;
  count: number;
  cards: DeckCardHydrated[];
  section: Section;
  onDelta: (row: DeckCardHydrated['row'], delta: number) => void;
  onMove: (row: DeckCardHydrated['row'], target: Section) => void;
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
        <div className={styles.emptySection}>Empty — add cards from search.</div>
      ) : (
        <div className={styles.deckList}>
          {cards.map((c) => (
            <DeckRow
              key={c.row.id}
              card={c}
              onDelta={(delta) => onDelta(c.row, delta)}
              onMove={(target) => onMove(c.row, target)}
              currentSection={section}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DeckRow({
  card,
  onDelta,
  onMove,
  currentSection,
}: {
  card: DeckCardHydrated;
  onDelta: (delta: number) => void;
  onMove: (target: Section) => void;
  currentSection: Section;
}) {
  const thumbSrc =
    card.preferredPrinting == null
      ? card.representative?.images?.small ??
        card.representative?.images?.normal ??
        null
      : card.representative?.images?.small ??
        card.representative?.images?.normal ??
        null;
  const canMoveMain = currentSection !== 'main' && card.frameType !== 'fusion' && card.frameType !== 'synchro' && card.frameType !== 'xyz' && card.frameType !== 'link';
  const canMoveExtra =
    currentSection !== 'extra' &&
    (card.frameType === 'fusion' || card.frameType === 'synchro' || card.frameType === 'xyz' || card.frameType === 'link');
  const canMoveSide = currentSection !== 'side';
  const priceLabel =
    card.unitPriceUsd != null
      ? `$${card.unitPriceUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      : '—';
  return (
    <div className={styles.deckRow}>
      {thumbSrc ? (
        <Image src={thumbSrc} alt="" width={40} height={56} className={styles.deckThumb} unoptimized />
      ) : (
        <div className={styles.deckThumb} aria-hidden />
      )}
      <div className={styles.deckBody}>
        <div className={styles.deckName}>{card.row.card_name}</div>
        <div className={styles.deckMeta}>
          {frameLabel(card.frameType)} · {priceLabel}
          {card.fnlStatus !== 'unlimited' && <FnlPill status={card.fnlStatus} />}
        </div>
      </div>
      <div className={styles.qtyControls}>
        <button
          type="button"
          className={styles.qtyBtn}
          onClick={() => onDelta(-1)}
          aria-label="Remove one copy"
        >
          −
        </button>
        <span className={styles.qtyValue}>{card.row.quantity}</span>
        <button
          type="button"
          className={styles.qtyBtn}
          onClick={() => onDelta(+1)}
          aria-label="Add one copy"
        >
          +
        </button>
      </div>
      <div className={styles.qtyControls}>
        {canMoveMain && (
          <button type="button" className={styles.moveBtn} onClick={() => onMove('main')}>
            → Main
          </button>
        )}
        {canMoveExtra && (
          <button type="button" className={styles.moveBtn} onClick={() => onMove('extra')}>
            → Extra
          </button>
        )}
        {canMoveSide && (
          <button type="button" className={styles.moveBtn} onClick={() => onMove('side')}>
            → Side
          </button>
        )}
      </div>
    </div>
  );
}

// ── Right sidebar ─────────────────────────────────────────

function SidePanel({ detail }: { detail: DeckDetail }) {
  return (
    <aside className={styles.sidePanel}>
      <LegalityCard legality={detail.legality} />
      <StatsCard detail={detail} />
      <ValueCard detail={detail} />
    </aside>
  );
}

function LegalityCard({ legality }: { legality: LegalityResult }) {
  const state = legality.state;
  const stateLabel =
    state === 'legal'
      ? 'Legal'
      : state === 'incomplete'
      ? 'Incomplete'
      : 'Illegal';
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>
        <span>Legality</span>
        <span className={styles.saveState}>{stateLabel}</span>
      </h3>
      {legality.issues.length === 0 ? (
        <div className={styles.legalityAllGood}>
          Every rule checked out. Main 40–60, Extra ≤ 15, Side ≤ 15, F&amp;L
          caps respected.
        </div>
      ) : (
        <div className={styles.legalityIssues}>
          {legality.issues.map((i, idx) => (
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

function StatsCard({ detail }: { detail: DeckDetail }) {
  const stats = useMemo(() => computeStats(detail.cards), [detail.cards]);
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>Deck stats</h3>
      <div>
        <div className={styles.statRow}>
          <span className={styles.statKey}>Monsters</span>
          <span className={styles.statValue}>{stats.monsters}</span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statKey}>Spells</span>
          <span className={styles.statValue}>{stats.spells}</span>
        </div>
        <div className={styles.statRow}>
          <span className={styles.statKey}>Traps</span>
          <span className={styles.statValue}>{stats.traps}</span>
        </div>
        {stats.monsterLevelAvg != null && (
          <div className={styles.statRow}>
            <span className={styles.statKey}>Avg monster level (main)</span>
            <span className={styles.statValue}>{stats.monsterLevelAvg.toFixed(1)}</span>
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

function ValueCard({ detail }: { detail: DeckDetail }) {
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>
        <span>Estimated value</span>
      </h3>
      {detail.totalValueUsd > 0 ? (
        <>
          <div className={styles.valueTotal}>
            ${detail.totalValueUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </div>
          <div className={styles.valueRow}>
            <span>Main</span>
            <span>${detail.mainValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
          </div>
          <div className={styles.valueRow}>
            <span>Extra</span>
            <span>${detail.extraValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
          </div>
          <div className={styles.valueRow}>
            <span>Side</span>
            <span>${detail.sideValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
          </div>
          {detail.missingPriceCount > 0 && (
            <div className={styles.valueMuted}>
              {detail.missingPriceCount} card{detail.missingPriceCount === 1 ? '' : 's'} without a current market price — excluded from totals.
            </div>
          )}
        </>
      ) : (
        <div className={styles.valueMuted}>
          No priced cards yet. Values use printing-scoped USD retail —
          preferred printing first, then a deterministic representative.
        </div>
      )}
    </section>
  );
}

// ── Stats (pure) ──────────────────────────────────────────

interface Stat {
  monsters: number;
  spells: number;
  traps: number;
  monsterLevelAvg: number | null;
  attributes: Array<{ name: string; count: number }>;
  races: Array<{ name: string; count: number }>;
  extraBreakdown: Array<{ name: string; count: number }>;
  archetypes: Array<{ name: string; count: number }>;
}

function computeStats(cards: DeckCardHydrated[]): Stat {
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
      if (typeof level === 'number') {
        for (let i = 0; i < q; i++) mainMonsterLevels.push(level);
      }
    }
    if (isMonsterFrame(ft)) {
      const attr = (c.representative?.gamedata as { attribute?: string } | null | undefined)?.attribute;
      if (typeof attr === 'string') attrCounter.set(attr, (attrCounter.get(attr) ?? 0) + q);
      const race = (c.representative?.gamedata as { race?: string } | null | undefined)?.race;
      if (typeof race === 'string') raceCounter.set(race, (raceCounter.get(race) ?? 0) + q);
    }
    if (c.row.section === 'extra') {
      extraCounter.set(frameLabel(ft).replace(' Monster', ''), (extraCounter.get(frameLabel(ft).replace(' Monster', '')) ?? 0) + q);
    }
    const archs = (c.representative?.gamedata as { archetypes?: string[] } | null | undefined)?.archetypes;
    if (Array.isArray(archs)) {
      for (const a of archs) archCounter.set(a, (archCounter.get(a) ?? 0) + q);
    }
  }

  const monsterLevelAvg =
    mainMonsterLevels.length > 0
      ? mainMonsterLevels.reduce((n, v) => n + v, 0) / mainMonsterLevels.length
      : null;

  return {
    monsters,
    spells,
    traps,
    monsterLevelAvg,
    attributes: [...attrCounter.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    races: [...raceCounter.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, count]) => ({ name, count })),
    extraBreakdown: [...extraCounter.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    archetypes: [...archCounter.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
  };
}
