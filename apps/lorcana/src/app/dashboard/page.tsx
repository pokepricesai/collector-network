// Lorcana dashboard — the primary logged-in collector hub.
//
// Reads the user's holdings + watchlist + snapshot history and renders
// a summary panel with a small inline SVG value chart. Every panel is
// fail-soft: if a helper errors, that panel renders "temporarily
// unavailable" rather than crashing the whole page.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser, createServerSupabase } from '@collector-network/auth';
import { listCollectionForCurrentUser } from '../../server/collection';
import { listWatchlistForCurrentUser } from '../../server/watchlist';
import { countBaseSlotsForSet } from '../../server/set-completion';
import {
  writeSnapshotIfDue,
  getCollectionValueHistory,
  type SnapshotRow,
} from '../../server/collection-snapshots';
import { getLorcanaCurrency } from '../../lib/currency-server';
import { formatPrice, CURRENCY_SOURCE_NAME } from '../../lib/currency';
import type { LorcanaCurrency } from '../../lib/currency';
import type { CollectionListItem } from '../../server/collection';
import { canonicalFor } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'Your Lorcana dashboard',
  description: 'Your Lorcana collection, watchlist and value history at a glance.',
  alternates: { canonical: canonicalFor('/dashboard') },
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?returnTo=/dashboard');

  const currency = await getLorcanaCurrency();

  // Trigger today's snapshot before we read history — safe if the
  // table is missing / user has no holdings.
  try { await writeSnapshotIfDue(currency); } catch { /* fail-soft */ }

  const [collectionRes, watchlistRes, history, setsStats] = await Promise.allSettled([
    listCollectionForCurrentUser(currency),
    listWatchlistForCurrentUser(currency),
    getCollectionValueHistory(currency, 30),
    computeSetsStats(currency),
  ]);

  const collection = collectionRes.status === 'fulfilled' ? collectionRes.value : null;
  const watchlist = watchlistRes.status === 'fulfilled' ? watchlistRes.value : null;
  const historyRows: SnapshotRow[] = history.status === 'fulfilled' ? history.value : [];
  const sets = setsStats.status === 'fulfilled' ? setsStats.value : null;

  const collectionOk = collection?.ok === true ? collection.value : null;
  const watchlistOk = watchlist?.ok === true ? watchlist.value : null;

  const totalCopies = collectionOk?.summary.totalCopies ?? 0;
  const totalValue = collectionOk?.summary.totalCurrent ?? 0;
  const missingPriceCount = collectionOk?.summary.missingPriceCount ?? 0;
  const mostRecent = collectionOk && collectionOk.items.length > 0 ? collectionOk.items[0]! : null;

  const currencyReminder =
    currency === 'USD'
      ? 'Values in USD (TCGPlayer)'
      : 'Values in EUR (Cardmarket)';

  return (
    <main style={pageStyle}>
      <header style={{ marginBottom: 24 }}>
        <div className="label-mono" style={{ color: 'var(--accent-2)' }}>Dashboard</div>
        <h1 style={{ margin: '4px 0 4px', fontFamily: 'Outfit, system-ui, sans-serif', fontSize: 30, letterSpacing: '-0.01em' }}>
          Your Lorcana dashboard
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{currencyReminder}</p>
      </header>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <StatTile
          label="Total cards"
          value={totalCopies.toLocaleString()}
          hint={collection == null ? 'Temporarily unavailable' : collectionOk == null ? 'Storage pending' : `${collectionOk.summary.uniqueHoldings} holdings`}
        />
        <StatTile
          label="Collection value"
          value={collectionOk ? formatPrice(totalValue, currency, { digits: 0 }) : '-'}
          hint={
            collection == null
              ? 'Temporarily unavailable'
              : collectionOk == null
              ? 'Storage pending'
              : missingPriceCount > 0
              ? `${CURRENCY_SOURCE_NAME[currency]} · ${missingPriceCount} unpriced`
              : CURRENCY_SOURCE_NAME[currency]
          }
        />
        <StatTile
          label="Sets started"
          value={sets == null ? '-' : sets.setsStarted.toLocaleString()}
          hint={sets == null ? 'Temporarily unavailable' : `${sets.setsCompleted} completed`}
        />
        <StatTile
          label="Watchlist"
          value={watchlistOk ? watchlistOk.count.toLocaleString() : '-'}
          hint={watchlist == null ? 'Temporarily unavailable' : watchlistOk == null ? 'Storage pending' : 'Cards you don’t yet own'}
        />
      </section>

      <section
        style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
          marginBottom: 24,
        }}
      >
        <div style={panelStyle}>
          <div className="label-mono">Collection value · last 30 days</div>
          <ValueChart rows={historyRows} currency={currency} />
        </div>

        <div style={panelStyle}>
          <div className="label-mono">Closest to completion</div>
          {sets == null ? (
            <p style={mutedText}>Temporarily unavailable.</p>
          ) : sets.closest.length === 0 ? (
            <p style={mutedText}>
              Once you start collecting a set, its completion progress will appear here.
            </p>
          ) : (
            <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
              {sets.closest.map((row) => (
                <li key={row.setId} style={{ display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{row.setName}</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                      {row.owned}/{row.total}
                    </span>
                  </div>
                  <div
                    aria-hidden
                    style={{
                      height: 6,
                      borderRadius: 999,
                      background: 'var(--surface-inset, rgba(0,0,0,0.06))',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.round((row.owned / Math.max(row.total, 1)) * 100)}%`,
                        background: 'var(--accent-2, #6A43BE)',
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {mostRecent && (
        <section style={{ ...panelStyle, marginBottom: 24 }}>
          <div className="label-mono">Most recent addition</div>
          <RecentItem item={mostRecent} currency={currency} />
        </section>
      )}

      <section style={panelStyle}>
        <div className="label-mono" style={{ marginBottom: 10 }}>Quick links</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/collection" className="btn btn-sm btn-primary">Collection</Link>
          <Link href="/watchlist" className="btn btn-sm btn-ghost">Watchlist</Link>
          <Link href="/browse" className="btn btn-sm btn-ghost">Characters</Link>
          <Link href="/card-finder" className="btn btn-sm btn-ghost">Card Finder</Link>
          <Link href="/insights" className="btn btn-sm btn-ghost">AI</Link>
          <Link href="/settings" className="btn btn-sm btn-ghost">Settings</Link>
        </div>
      </section>
    </main>
  );
}

// ── Sets stats ──────────────────────────────────────────────────

interface SetStat {
  setId: string;
  setName: string;
  owned: number;
  total: number;
}
interface SetsStats {
  setsStarted: number;
  setsCompleted: number;
  closest: SetStat[];
}

async function computeSetsStats(currency: LorcanaCurrency): Promise<SetsStats> {
  void currency;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { setsStarted: 0, setsCompleted: 0, closest: [] };

  // Load the user's owned card ids (via collection). Currency doesn't
  // affect owned counts, so this is a lightweight read.
  const { data: rows, error } = await supabase
    .from('lorcana_collection_items')
    .select('tcg_card_id');
  if (error || !rows || rows.length === 0) {
    return { setsStarted: 0, setsCompleted: 0, closest: [] };
  }
  const ownedCardIds = new Set<string>();
  for (const r of rows as { tcg_card_id: string }[]) ownedCardIds.add(r.tcg_card_id);
  if (ownedCardIds.size === 0) return { setsStarted: 0, setsCompleted: 0, closest: [] };

  // Load set_id + id for owned cards so we can group.
  const IN_BATCH = 100;
  const cardIds = [...ownedCardIds];
  const setIdByCard = new Map<string, string>();
  for (let i = 0; i < cardIds.length; i += IN_BATCH) {
    const batch = cardIds.slice(i, i + IN_BATCH);
    const { data } = await supabase
      .from('tcg_cards')
      .select('id, set_id')
      .in('id', batch);
    for (const c of (data as { id: string; set_id: string }[] | null) ?? []) {
      setIdByCard.set(c.id, c.set_id);
    }
  }
  const ownedBySet = new Map<string, Set<string>>();
  for (const cardId of ownedCardIds) {
    const setId = setIdByCard.get(cardId);
    if (!setId) continue;
    const bucket = ownedBySet.get(setId) ?? new Set<string>();
    bucket.add(cardId);
    ownedBySet.set(setId, bucket);
  }

  // For each set touched, count total distinct cards + fetch name.
  const setIds = [...ownedBySet.keys()];
  if (setIds.length === 0) return { setsStarted: 0, setsCompleted: 0, closest: [] };
  const [{ data: setRows }, totalsBySet] = await Promise.all([
    supabase.from('tcg_sets').select('id, name').in('id', setIds),
    countCardsPerSet(supabase, setIds),
  ]);
  const nameById = new Map<string, string>();
  for (const s of (setRows as { id: string; name: string }[] | null) ?? []) {
    nameById.set(s.id, s.name);
  }

  const stats: SetStat[] = [];
  let setsCompleted = 0;
  for (const setId of setIds) {
    const owned = ownedBySet.get(setId)?.size ?? 0;
    const total = totalsBySet.get(setId) ?? 0;
    if (total === 0) continue;
    if (owned >= total) setsCompleted += 1;
    stats.push({
      setId,
      setName: nameById.get(setId) ?? setId,
      owned,
      total,
    });
  }
  // Sort by remaining ascending (closest to done), then by percent
  // descending. Exclude already-completed sets from "closest".
  const closest = stats
    .filter((s) => s.owned < s.total)
    .sort((a, b) => {
      const remainingA = a.total - a.owned;
      const remainingB = b.total - b.owned;
      if (remainingA !== remainingB) return remainingA - remainingB;
      const pctA = a.owned / Math.max(a.total, 1);
      const pctB = b.owned / Math.max(b.total, 1);
      return pctB - pctA;
    })
    .slice(0, 3);

  return {
    setsStarted: stats.length,
    setsCompleted,
    closest,
  };
}

async function countCardsPerSet(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  setIds: readonly string[],
): Promise<Map<string, number>> {
  // Uses the canonical Lorcana base-slot rule from
  // set-completion.ts. One HEAD count per set — small N (< 25
  // typically). Keeps the query simple and avoids a group-by RPC.
  const out = new Map<string, number>();
  await Promise.all(
    setIds.map(async (setId) => {
      out.set(setId, await countBaseSlotsForSet(supabase, setId));
    }),
  );
  return out;
}

// ── Inline value chart ──────────────────────────────────────────

function ValueChart({ rows, currency }: { rows: readonly SnapshotRow[]; currency: LorcanaCurrency }) {
  if (rows.length < 2) {
    return (
      <p style={{ ...mutedText, margin: '14px 0 0' }}>
        Value history builds as you add cards. First snapshot recorded today.
      </p>
    );
  }

  const width = 640;
  const height = 160;
  const padX = 12;
  const padY = 14;
  const values = rows.map((r) => Number(r.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);

  const points = rows.map((r, i) => {
    const x = padX + (i / Math.max(rows.length - 1, 1)) * (width - padX * 2);
    const y = padY + (1 - (Number(r.value) - min) / spread) * (height - padY * 2);
    return { x, y };
  });

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const areaPath =
    `${path} L ${points[points.length - 1]!.x.toFixed(1)} ${height - padY} L ${points[0]!.x.toFixed(1)} ${height - padY} Z`;

  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const delta = Number(last.value) - Number(first.value);

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 22, fontWeight: 800, color: 'var(--text-strong)' }}>
          {formatPrice(Number(last.value), currency, { digits: 0 })}
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: delta >= 0 ? 'var(--positive, #157347)' : 'var(--negative, #B12A2F)',
          }}
        >
          {delta >= 0 ? '+' : ''}{formatPrice(delta, currency, { digits: 0 })}
          <span style={{ color: 'var(--text-muted)', fontWeight: 500, marginLeft: 6 }}>
            since {first.observed_on}
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="Collection value trend"
      >
        <path d={areaPath} fill="var(--accent-2, #6A43BE)" fillOpacity="0.12" />
        <path
          d={path}
          fill="none"
          stroke="var(--accent-2, #6A43BE)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// ── Recent item ────────────────────────────────────────────────

function RecentItem({ item, currency }: { item: CollectionListItem; currency: LorcanaCurrency }) {
  const cardName = item.card?.name ?? 'Unknown card';
  const setName = item.set?.name ?? '';
  const priceLabel =
    item.priced.unitValue != null
      ? formatPrice(item.priced.unitValue * item.row.quantity, currency)
      : 'Unpriced';
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 200px', minWidth: 160 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-strong)' }}>{cardName}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {setName}{item.row.is_graded && item.row.grader && item.row.grade ? ` · ${item.row.grader.toUpperCase()} ${item.row.grade}` : ''} · ×{item.row.quantity}
        </div>
      </div>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 16 }}>{priceLabel}</div>
      <Link href="/collection" className="btn btn-sm btn-ghost">Open collection</Link>
    </div>
  );
}

// ── UI primitives ──────────────────────────────────────────────

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={panelStyle}>
      <div className="label-mono">{label}</div>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 24, fontWeight: 800, color: 'var(--text-strong)', marginTop: 2 }}>
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
  padding: 16,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 14,
};

const mutedText: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: 'var(--text-muted)',
  lineHeight: 1.55,
};
