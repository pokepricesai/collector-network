'use client';

// Interactive watchlist. Renders the server-hydrated items with
// search + filter + sort + inline target-price editor + remove.
// Movement cells show 7D/30D/90D absolute + percentage; when the
// underlying series doesn't reach the lookback boundary they render
// "Not enough history" — never a fabricated number.

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import type { WatchlistListItem } from '../../server/watchlist';
import type { MovementResult, TargetCurrency } from '../../lib/watchlist-types';
import { removeWatchAction, updateTargetAction } from './actions';
import { DialogPortal } from '../../components/collection/DialogPortal';
import dialogStyles from '../../components/collection/AddToCollection.module.css';
import styles from './Watchlist.module.css';

type Filter = 'all' | 'target-reached' | 'movers-7d' | 'movers-30d' | 'movers-90d';
type Sort = 'newest' | 'oldest' | 'name' | 'value-desc' | 'movers-7d' | 'movers-30d' | 'movers-90d';

interface Props { items: WatchlistListItem[]; }

export function WatchlistClient({ items }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [editing, setEditing] = useState<WatchlistListItem | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<WatchlistListItem | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = items.filter((it) => {
      if (filter === 'target-reached' && !it.targetReached) return false;
      if (filter === 'movers-7d' && (it.movement?.windows.d7?.percent == null)) return false;
      if (filter === 'movers-30d' && (it.movement?.windows.d30?.percent == null)) return false;
      if (filter === 'movers-90d' && (it.movement?.windows.d90?.percent == null)) return false;
      if (q) {
        const hay = [
          it.card?.name,
          it.set?.name,
          it.set?.code,
          it.printing?.collector_number,
          it.card?.rarity,
          it.row.note,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    out.sort((a, b) => {
      switch (sort) {
        case 'newest':
          return b.row.created_at.localeCompare(a.row.created_at);
        case 'oldest':
          return a.row.created_at.localeCompare(b.row.created_at);
        case 'name':
          return (a.card?.name ?? '').localeCompare(b.card?.name ?? '');
        case 'value-desc':
          return (b.currentPrice ?? -1) - (a.currentPrice ?? -1);
        case 'movers-7d':
          return absPct(b.movement?.windows.d7) - absPct(a.movement?.windows.d7);
        case 'movers-30d':
          return absPct(b.movement?.windows.d30) - absPct(a.movement?.windows.d30);
        case 'movers-90d':
          return absPct(b.movement?.windows.d90) - absPct(a.movement?.windows.d90);
      }
    });
    return out;
  }, [items, query, filter, sort]);

  return (
    <>
      <div className={styles.controls}>
        <input
          type="search"
          placeholder="Search by card, set, note…"
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className={styles.filter}
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
        >
          <option value="all">All rows</option>
          <option value="target-reached">Target reached</option>
          <option value="movers-7d">Has 7D data</option>
          <option value="movers-30d">Has 30D data</option>
          <option value="movers-90d">Has 90D data</option>
        </select>
        <select
          className={styles.sort}
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          <option value="newest">Newest added</option>
          <option value="oldest">Oldest added</option>
          <option value="name">Card name A–Z</option>
          <option value="value-desc">Current value ↓</option>
          <option value="movers-7d">Biggest 7D movers</option>
          <option value="movers-30d">Biggest 30D movers</option>
          <option value="movers-90d">Biggest 90D movers</option>
        </select>
        <span className={styles.count}>
          {filtered.length} / {items.length}
        </span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Card</th>
              <th style={{ textAlign: 'right' }}>Current</th>
              <th style={{ textAlign: 'right' }}>7D</th>
              <th style={{ textAlign: 'right' }}>30D</th>
              <th style={{ textAlign: 'right' }}>90D</th>
              <th style={{ textAlign: 'right' }}>Target</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((it) => (
              <Row
                key={it.row.id}
                item={it}
                onEditTarget={() => setEditing(it)}
                onRemove={() => setConfirmingRemove(it)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {editing && <EditTargetDialog item={editing} onClose={() => setEditing(null)} />}
      {confirmingRemove && (
        <RemoveDialog item={confirmingRemove} onClose={() => setConfirmingRemove(null)} />
      )}
    </>
  );
}

function absPct(m: MovementResult | null | undefined): number {
  return m?.percent == null ? -Infinity : Math.abs(m.percent);
}

function Row({
  item,
  onEditTarget,
  onRemove,
}: {
  item: WatchlistListItem;
  onEditTarget: () => void;
  onRemove: () => void;
}) {
  const { row, card, printing, set, currentPrice, currentCurrency, currentSource, movement, targetReached } = item;
  const cardHref =
    card && printing && printing.tcggraph_printing_key && printing.collector_number
      ? `/card/${toSlug(card.name)}/printing/${encodeURIComponent(printing.collector_number)}/${encodeURIComponent(printing.tcggraph_printing_key)}`
      : card
      ? `/card/${toSlug(card.name)}`
      : undefined;
  const editionLabel =
    printing?.edition === '1st_edition'
      ? '1st Ed.'
      : printing?.edition === 'limited'
      ? 'Limited'
      : 'Unlimited';
  const thumb =
    card?.images?.small ?? card?.images?.normal ?? card?.images?.large ?? null;
  return (
    <tr>
      <td data-label="Card">
        <div className={styles.cardCell}>
          {thumb ? (
            <Image src={thumb} alt="" width={44} height={64} className={styles.thumb} unoptimized />
          ) : (
            <div className={styles.thumb} aria-hidden />
          )}
          <div className={styles.cardBody}>
            {cardHref ? (
              <Link href={cardHref} className={styles.cardName}>
                {card?.name ?? '(unknown card)'}
              </Link>
            ) : (
              <span className={styles.cardName}>(unknown card)</span>
            )}
            <div className={styles.cardMeta}>
              {[set?.code?.toUpperCase(), printing?.collector_number, card?.rarity, editionLabel, printing?.language]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        </div>
      </td>
      <td data-label="Current" className={styles.priceCell}>
        {currentPrice != null ? (
          <>
            <span className={styles.priceValue}>
              {currencySymbol(currentCurrency)}
              {currentPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              <span className={styles.priceSource}>{currentCurrency}</span>
            </span>
            {currentSource && (
              <span className={styles.priceSource}>{currentSource.split('.').pop()}</span>
            )}
          </>
        ) : (
          <span className={styles.priceMuted}>no current market price</span>
        )}
      </td>
      <MovementCell result={movement?.windows.d7 ?? null} />
      <MovementCell result={movement?.windows.d30 ?? null} />
      <MovementCell result={movement?.windows.d90 ?? null} />
      <td data-label="Target" className={styles.priceCell}>
        {row.target_price != null && row.target_currency ? (
          <>
            <span className={styles.priceValue}>
              {currencySymbol(row.target_currency)}
              {row.target_price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              <span className={styles.priceSource}>{row.target_currency}</span>
            </span>
            {targetReached && <span className={styles.targetPill}>Target reached</span>}
            {!targetReached && currentPrice != null && currentCurrency !== row.target_currency && (
              <span className={styles.priceSource}>currency mismatch - no compare</span>
            )}
          </>
        ) : (
          <span className={styles.priceMuted}>-</span>
        )}
      </td>
      <td data-label="Actions" className={styles.actionsCell}>
        <button type="button" className={styles.actionBtn} onClick={onEditTarget}>
          Target
        </button>
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.actionRemove}`}
          onClick={onRemove}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

function MovementCell({ result }: { result: MovementResult | null }) {
  if (!result || result.absolute == null || result.percent == null) {
    return (
      <td className={styles.movementCell}>
        <span className={styles.priceMuted}>Not enough history</span>
      </td>
    );
  }
  const sign = result.percent > 0 ? '+' : result.percent < 0 ? '−' : '';
  const cls =
    result.percent > 0
      ? styles.movementUp
      : result.percent < 0
      ? styles.movementDown
      : styles.movementFlat;
  return (
    <td className={styles.movementCell}>
      <span className={cls}>
        {sign}
        {Math.abs(result.percent).toFixed(1)}%
      </span>
      <span className={styles.priceSource}>
        {sign}
        {currencySymbol(result.currency)}
        {Math.abs(result.absolute).toFixed(2)}
      </span>
    </td>
  );
}

function currencySymbol(c: string | null | undefined): string {
  return c === 'USD' ? '$' : c === 'EUR' ? '€' : '';
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Edit target dialog ────────────────────────────────────

function EditTargetDialog({
  item,
  onClose,
}: {
  item: WatchlistListItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState(
    item.row.target_price != null ? String(item.row.target_price) : '',
  );
  const [currency, setCurrency] = useState<TargetCurrency>(
    item.row.target_currency ?? 'USD',
  );
  const [note, setNote] = useState(item.row.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await updateTargetAction(item.row.id, {
        target_price: target.trim() ? Number(target) : null,
        target_currency: target.trim() ? currency : null,
        note: note.trim() || null,
      });
      if (r.ok) {
        onClose();
        router.refresh();
      } else {
        setError(r.error ?? 'Could not update target');
      }
    });
  }

  return (
    <DialogPortal>
      <div
        className={dialogStyles.backdrop}
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className={dialogStyles.dialog}>
          <h2 className={dialogStyles.title}>Set target price</h2>
          <div className={dialogStyles.cardLine}>
            <div>
              <p className={dialogStyles.cardName}>{item.card?.name ?? 'Watched card'}</p>
              <p className={dialogStyles.cardMeta}>
                {[item.set?.code?.toUpperCase(), item.printing?.collector_number, item.card?.rarity]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>
          <form onSubmit={submit} className={dialogStyles.form}>
            <div className={dialogStyles.row2}>
              <div className={dialogStyles.field}>
                <label className={dialogStyles.label}>Target price</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={dialogStyles.input}
                  placeholder="leave blank to clear"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </div>
              <div className={dialogStyles.field}>
                <label className={dialogStyles.label}>Currency</label>
                <select
                  className={dialogStyles.select}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as TargetCurrency)}
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>
            <div className={dialogStyles.field}>
              <label className={dialogStyles.label}>Note</label>
              <textarea
                className={dialogStyles.textarea}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {error && <p className={dialogStyles.error}>{error}</p>}
            <div className={dialogStyles.actions}>
              <button
                type="button"
                className={dialogStyles.cancel}
                onClick={onClose}
                disabled={pending}
              >
                Cancel
              </button>
              <button type="submit" className={dialogStyles.submit} disabled={pending}>
                {pending ? 'Saving…' : 'Save target'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </DialogPortal>
  );
}

// ── Remove confirm dialog ─────────────────────────────────

function RemoveDialog({
  item,
  onClose,
}: {
  item: WatchlistListItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await removeWatchAction(item.row.id);
      if (r.ok) {
        onClose();
        router.refresh();
      } else {
        setError(r.error ?? 'Could not remove');
      }
    });
  }
  return (
    <DialogPortal>
      <div
        className={dialogStyles.backdrop}
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className={dialogStyles.dialog} style={{ maxWidth: 380 }}>
          <h2 className={dialogStyles.title}>Remove from watchlist?</h2>
          <p
            style={{ fontSize: 13, color: 'var(--ygo-text-muted)', margin: '0 0 12px 0' }}
          >
            {item.card?.name ?? 'This card'} - {item.printing?.collector_number}. Your
            target price and note will be discarded.
          </p>
          {error && <p className={dialogStyles.error}>{error}</p>}
          <div className={dialogStyles.actions}>
            <button
              type="button"
              className={dialogStyles.cancel}
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              className={dialogStyles.submit}
              style={{
                background: 'var(--ygo-accent-crimson)',
                borderColor: 'var(--ygo-accent-crimson)',
                color: 'var(--ygo-text-primary)',
              }}
              onClick={submit}
              disabled={pending}
            >
              {pending ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}
