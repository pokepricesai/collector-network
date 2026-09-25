'use client';

// Interactive collection list. Renders the server-hydrated items
// with search + filter + sort, inline edit modal, delete confirm.
// Pagination is client-side (page size 50) — the summary is always
// computed server-side across the whole collection so pagination
// never distorts the totals.

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import type { CollectionListItem } from '../../server/collection';
import {
  CONDITION_LABELS,
  CONDITION_VALUES,
  GRADER_VALUES,
  PURCHASE_CURRENCIES,
  type Condition,
  type Grader,
  type PurchaseCurrency,
} from '../../lib/collection-types';
import { deleteCollectionAction, updateCollectionAction } from './actions';
import editStyles from '../../components/collection/AddToCollection.module.css';
import styles from './Collection.module.css';

const PAGE_SIZE = 50;

type Filter = 'all' | 'raw' | 'graded' | 'missing-price';
type Sort = 'newest' | 'oldest' | 'value-desc' | 'value-asc' | 'name-asc';

interface Props {
  items: CollectionListItem[];
}

export function CollectionClient({ items }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<CollectionListItem | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<CollectionListItem | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = items.filter((it) => {
      if (filter === 'raw' && it.row.is_graded) return false;
      if (filter === 'graded' && !it.row.is_graded) return false;
      if (filter === 'missing-price' && it.priced.unitValueUsd != null) return false;
      if (q) {
        const hay = [
          it.card?.name,
          it.set?.name,
          it.set?.code,
          it.printing?.collector_number,
          it.card?.rarity,
          it.row.grader,
          it.row.grade,
          it.row.notes,
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
        case 'value-desc':
          return (
            (b.priced.unitValueUsd ?? -1) * b.row.quantity -
            (a.priced.unitValueUsd ?? -1) * a.row.quantity
          );
        case 'value-asc':
          return (
            (a.priced.unitValueUsd ?? Number.POSITIVE_INFINITY) * a.row.quantity -
            (b.priced.unitValueUsd ?? Number.POSITIVE_INFINITY) * b.row.quantity
          );
        case 'name-asc':
          return (a.card?.name ?? '').localeCompare(b.card?.name ?? '');
      }
    });
    return out;
  }, [items, query, filter, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const view = filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <>
      <div className={styles.controls}>
        <input
          type="search"
          placeholder="Search by card, set, grader, notes…"
          className={styles.search}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <select
          className={styles.filter}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setPage(0);
          }}
        >
          <option value="all">All rows</option>
          <option value="raw">Raw only</option>
          <option value="graded">Graded only</option>
          <option value="missing-price">Missing price</option>
        </select>
        <select
          className={styles.sort}
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          <option value="newest">Newest added</option>
          <option value="oldest">Oldest added</option>
          <option value="value-desc">Value ↓</option>
          <option value="value-asc">Value ↑</option>
          <option value="name-asc">Card name A–Z</option>
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
              <th>Kind</th>
              <th>Qty</th>
              <th style={{ textAlign: 'right' }}>Unit value</th>
              <th style={{ textAlign: 'right' }}>Total value</th>
              <th style={{ textAlign: 'right' }}>Cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {view.map((it) => (
              <Row
                key={it.row.id}
                item={it}
                onEdit={() => setEditing(it)}
                onDelete={() => setConfirmingDelete(it)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className={styles.pager}>
          <button
            className={styles.pagerBtn}
            disabled={clampedPage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Prev
          </button>
          <span>
            page {clampedPage + 1} / {pageCount}
          </span>
          <button
            className={styles.pagerBtn}
            disabled={clampedPage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next →
          </button>
        </div>
      )}

      {editing && (
        <EditDialog item={editing} onClose={() => setEditing(null)} />
      )}
      {confirmingDelete && (
        <DeleteDialog
          item={confirmingDelete}
          onClose={() => setConfirmingDelete(null)}
        />
      )}
    </>
  );
}

function Row({
  item,
  onEdit,
  onDelete,
}: {
  item: CollectionListItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { row, card, printing, set, priced } = item;
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
  const unitValueLabel = priced.unitValueUsd != null
    ? `$${priced.unitValueUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
    : null;
  const totalValueLabel = priced.unitValueUsd != null
    ? `$${(priced.unitValueUsd * row.quantity).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
    : null;
  const costLabel =
    row.purchase_price != null && row.purchase_currency
      ? `${row.purchase_currency === 'USD' ? '$' : row.purchase_currency === 'EUR' ? '€' : ''}${row.purchase_price.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${row.purchase_currency}`
      : null;

  const thumb =
    card?.images?.small ?? card?.images?.normal ?? card?.images?.large ?? null;

  return (
    <tr>
      <td data-label="Card">
        <div className={styles.cardCell}>
          {thumb ? (
            <Image
              src={thumb}
              alt=""
              width={44}
              height={64}
              className={styles.thumb}
              unoptimized
            />
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
      <td data-label="Kind">
        {row.is_graded ? (
          <span className={`${styles.kindPill} ${styles.kindGraded}`}>
            {row.grader?.toUpperCase()} {row.grade}
          </span>
        ) : (
          <span className={`${styles.kindPill} ${styles.kindRaw}`}>
            {row.condition ? CONDITION_LABELS[row.condition] : 'Raw'}
          </span>
        )}
      </td>
      <td data-label="Qty">{row.quantity}</td>
      <td data-label="Unit value" className={styles.priceCell}>
        {unitValueLabel ? (
          <>
            {unitValueLabel}
            <span className={styles.priceSource}>
              {priced.valueUsdSource === 'card-graded-family'
                ? 'card-scoped'
                : priced.valueUsdSource === 'printing-graded'
                ? 'printing-graded'
                : 'printing-retail'}
            </span>
          </>
        ) : (
          <span className={styles.priceNone}>no current market price</span>
        )}
      </td>
      <td data-label="Total value" className={styles.priceCell}>
        {totalValueLabel ?? <span className={styles.priceNone}>—</span>}
      </td>
      <td data-label="Cost" className={styles.priceCell}>
        {costLabel ?? <span className={styles.priceNone}>—</span>}
      </td>
      <td data-label="Actions" className={styles.actionsCell}>
        <button type="button" className={styles.actionBtn} onClick={onEdit}>
          Edit
        </button>
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.actionDelete}`}
          onClick={onDelete}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

// Very light client-side slug so we can build the card + printing
// links without an extra server hop. Mirrors the identical
// lib/slug.ts toCardSlug shape for name → slug.
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Edit dialog ────────────────────────────────────────────

function EditDialog({
  item,
  onClose,
}: {
  item: CollectionListItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const { row } = item;
  const [quantity, setQuantity] = useState(row.quantity);
  const [tab, setTab] = useState<'raw' | 'graded'>(row.is_graded ? 'graded' : 'raw');
  const [condition, setCondition] = useState<Condition>(row.condition ?? 'near-mint');
  const [grader, setGrader] = useState<Grader>((row.grader as Grader | null) ?? 'psa');
  const [grade, setGrade] = useState(row.grade ?? '10');
  const [purchasePrice, setPurchasePrice] = useState(
    row.purchase_price != null ? String(row.purchase_price) : '',
  );
  const [purchaseCurrency, setPurchaseCurrency] = useState<PurchaseCurrency>(
    (row.purchase_currency as PurchaseCurrency | null) ?? 'USD',
  );
  const [purchaseDate, setPurchaseDate] = useState(row.purchase_date ?? '');
  const [notes, setNotes] = useState(row.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await updateCollectionAction(row.id, {
        tcg_card_id: row.tcg_card_id,
        tcg_printing_id: row.tcg_printing_id,
        quantity,
        is_graded: tab === 'graded',
        grader: tab === 'graded' ? grader : null,
        grade: tab === 'graded' ? grade.trim() : null,
        condition: tab === 'raw' ? condition : null,
        purchase_price: purchasePrice.trim() ? Number(purchasePrice) : null,
        purchase_currency: purchasePrice.trim() ? purchaseCurrency : null,
        purchase_date: purchaseDate || null,
        notes: notes.trim() || null,
      });
      if (r.ok) {
        onClose();
        router.refresh();
      } else {
        setError(r.error ?? 'Update failed');
      }
    });
  }

  return (
    <div
      className={editStyles.backdrop}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={editStyles.dialog}>
        <h2 className={editStyles.title}>Edit holding</h2>
        <div className={editStyles.cardLine}>
          <div>
            <p className={editStyles.cardName}>{item.card?.name ?? 'Unknown card'}</p>
            <p className={editStyles.cardMeta}>
              {[item.set?.code?.toUpperCase(), item.printing?.collector_number, item.card?.rarity]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        <form onSubmit={submit} className={editStyles.form}>
          <div className={editStyles.tabs}>
            <button
              type="button"
              className={tab === 'raw' ? `${editStyles.tab} ${editStyles.tabActive}` : editStyles.tab}
              onClick={() => setTab('raw')}
            >
              Raw
            </button>
            <button
              type="button"
              className={tab === 'graded' ? `${editStyles.tab} ${editStyles.tabActive}` : editStyles.tab}
              onClick={() => setTab('graded')}
            >
              Graded
            </button>
          </div>
          <div className={editStyles.row2}>
            <div className={editStyles.field}>
              <label className={editStyles.label}>Quantity</label>
              <input
                type="number"
                min={1}
                max={999}
                className={editStyles.input}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value) || 1)}
              />
            </div>
            {tab === 'raw' ? (
              <div className={editStyles.field}>
                <label className={editStyles.label}>Condition</label>
                <select
                  className={editStyles.select}
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as Condition)}
                >
                  {CONDITION_VALUES.map((c) => (
                    <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className={editStyles.field}>
                <label className={editStyles.label}>Grader</label>
                <select
                  className={editStyles.select}
                  value={grader}
                  onChange={(e) => setGrader(e.target.value as Grader)}
                >
                  {GRADER_VALUES.map((g) => (
                    <option key={g} value={g}>{g.toUpperCase()}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {tab === 'graded' && (
            <div className={editStyles.field}>
              <label className={editStyles.label}>Grade</label>
              <input
                type="text"
                maxLength={8}
                className={editStyles.input}
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
              />
            </div>
          )}
          <div className={editStyles.row2}>
            <div className={editStyles.field}>
              <label className={editStyles.label}>Purchase price</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={editStyles.input}
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
              />
            </div>
            <div className={editStyles.field}>
              <label className={editStyles.label}>Currency</label>
              <select
                className={editStyles.select}
                value={purchaseCurrency}
                onChange={(e) => setPurchaseCurrency(e.target.value as PurchaseCurrency)}
              >
                {PURCHASE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={editStyles.field}>
            <label className={editStyles.label}>Purchase date</label>
            <input
              type="date"
              className={editStyles.input}
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </div>
          <div className={editStyles.field}>
            <label className={editStyles.label}>Notes</label>
            <textarea
              className={editStyles.textarea}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {error && <p className={editStyles.error}>{error}</p>}
          <div className={editStyles.actions}>
            <button type="button" className={editStyles.cancel} onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className={editStyles.submit} disabled={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete confirm dialog ──────────────────────────────────

function DeleteDialog({
  item,
  onClose,
}: {
  item: CollectionListItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await deleteCollectionAction(item.row.id);
      if (r.ok) {
        onClose();
        router.refresh();
      } else {
        setError(r.error ?? 'Delete failed');
      }
    });
  }
  return (
    <div
      className={editStyles.backdrop}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={editStyles.dialog} style={{ maxWidth: 380 }}>
        <h2 className={editStyles.title}>Delete this holding?</h2>
        <p style={{ fontSize: 13, color: 'var(--ygo-text-muted)', margin: '0 0 12px 0' }}>
          {item.card?.name ?? 'This holding'} — {item.row.quantity}×{' '}
          {item.row.is_graded ? `${item.row.grader?.toUpperCase()} ${item.row.grade}` : 'raw'}.
          This cannot be undone.
        </p>
        {error && <p className={editStyles.error}>{error}</p>}
        <div className={editStyles.actions}>
          <button type="button" className={editStyles.cancel} onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className={editStyles.submit}
            style={{ background: 'var(--ygo-accent-crimson)', borderColor: 'var(--ygo-accent-crimson)', color: 'var(--ygo-text-primary)' }}
            onClick={submit}
            disabled={pending}
          >
            {pending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
