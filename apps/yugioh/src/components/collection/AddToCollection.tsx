'use client';

// AddToCollection — small button + modal used from card pages and
// printing pages. Behaviour differs by context:
//
//   ▸ Printing pages preselect the exact printing. The user just
//     picks raw/graded and (for graded) grader + grade.
//   ▸ Card family pages MUST force a printing choice — copies of a
//     card are never treated as financially interchangeable.
//
// Not signed in? The button becomes a link to /sign-in?returnTo=…
// so the user comes right back to the same card/printing.

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CONDITION_LABELS,
  CONDITION_VALUES,
  GRADER_VALUES,
  PURCHASE_CURRENCIES,
  type Condition,
  type Grader,
  type PurchaseCurrency,
} from '../../lib/collection-types';
import { addCollectionAction } from '../../app/collection/actions';
import { DialogPortal } from './DialogPortal';
import styles from './AddToCollection.module.css';

export interface PrintingOption {
  id: string;
  label: string;      // "LOB-001 · Ultra Rare · 1st Edition · English"
}

interface Props {
  isSignedIn: boolean;
  currentPathname: string; // for returnTo when not signed in
  cardId: string;
  cardName: string;
  cardImageUrl?: string | null;
  // Either:
  //   - preselected printing (printing page), OR
  //   - a list of printings to choose from (card family page)
  fixedPrinting?: PrintingOption;
  availablePrintings?: PrintingOption[];
  variant?: 'primary' | 'ghost';
}

export function AddToCollection(props: Props) {
  const { isSignedIn, currentPathname } = props;
  const [open, setOpen] = useState(false);

  if (!isSignedIn) {
    const returnTo = encodeURIComponent(currentPathname);
    return (
      <Link
        href={`/sign-in?returnTo=${returnTo}`}
        className={
          props.variant === 'ghost'
            ? `${styles.trigger} ${styles.triggerGhost}`
            : styles.trigger
        }
      >
        + Add to Collection
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        className={
          props.variant === 'ghost'
            ? `${styles.trigger} ${styles.triggerGhost}`
            : styles.trigger
        }
        onClick={() => setOpen(true)}
      >
        + Add to Collection
      </button>
      {open && (
        <Dialog
          onClose={() => setOpen(false)}
          cardId={props.cardId}
          cardName={props.cardName}
          fixedPrinting={props.fixedPrinting}
          availablePrintings={props.availablePrintings}
        />
      )}
    </>
  );
}

interface DialogProps {
  onClose: () => void;
  cardId: string;
  cardName: string;
  fixedPrinting?: PrintingOption;
  availablePrintings?: PrintingOption[];
}

function Dialog(props: DialogProps) {
  const router = useRouter();
  const [tab, setTab] = useState<'raw' | 'graded'>('raw');
  const [printingId, setPrintingId] = useState(props.fixedPrinting?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState<Condition>('near-mint');
  const [grader, setGrader] = useState<Grader>('psa');
  const [grade, setGrade] = useState('10');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseCurrency, setPurchaseCurrency] = useState<PurchaseCurrency>('USD');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const needsPrintingPicker = !props.fixedPrinting;
  const canSubmit = useMemo(() => {
    if (isPending) return false;
    if (!printingId) return false;
    if (quantity < 1) return false;
    if (tab === 'graded' && (!grader || !grade.trim())) return false;
    return true;
  }, [isPending, printingId, quantity, tab, grader, grade]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setTableMissing(false);
    startTransition(async () => {
      const result = await addCollectionAction({
        tcg_card_id: props.cardId,
        tcg_printing_id: printingId,
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
      if (result.ok) {
        props.onClose();
        router.refresh();
      } else if (result.tableMissing) {
        setTableMissing(true);
      } else {
        setError(result.error ?? 'Something went wrong');
      }
    });
  }

  return (
    <DialogPortal>
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`Add ${props.cardName} to your collection`}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className={styles.dialog}>
        <h2 className={styles.title}>Add to Collection</h2>
        <div className={styles.cardLine}>
          <div>
            <p className={styles.cardName}>{props.cardName}</p>
            {props.fixedPrinting && (
              <p className={styles.cardMeta}>{props.fixedPrinting.label}</p>
            )}
          </div>
        </div>

        <form onSubmit={submit} className={styles.form}>
          {needsPrintingPicker && (
            <div className={styles.field}>
              <label htmlFor="ac-printing" className={styles.label}>
                Printing *
              </label>
              <select
                id="ac-printing"
                className={styles.select}
                value={printingId}
                onChange={(e) => setPrintingId(e.target.value)}
                required
              >
                <option value="">Choose a printing…</option>
                {(props.availablePrintings ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'raw'}
              className={tab === 'raw' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => setTab('raw')}
            >
              Raw
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'graded'}
              className={tab === 'graded' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => setTab('graded')}
            >
              Graded
            </button>
          </div>

          <div className={styles.row2}>
            <div className={styles.field}>
              <label htmlFor="ac-qty" className={styles.label}>Quantity</label>
              <input
                id="ac-qty"
                type="number"
                min={1}
                max={999}
                className={styles.input}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value) || 1)}
              />
            </div>

            {tab === 'raw' ? (
              <div className={styles.field}>
                <label htmlFor="ac-cond" className={styles.label}>Condition</label>
                <select
                  id="ac-cond"
                  className={styles.select}
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as Condition)}
                >
                  {CONDITION_VALUES.map((c) => (
                    <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className={styles.field}>
                <label htmlFor="ac-grader" className={styles.label}>Grader</label>
                <select
                  id="ac-grader"
                  className={styles.select}
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
            <div className={styles.field}>
              <label htmlFor="ac-grade" className={styles.label}>Grade *</label>
              <input
                id="ac-grade"
                type="text"
                className={styles.input}
                maxLength={8}
                placeholder="e.g. 10, 9, 9.5"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                required
              />
            </div>
          )}

          <div className={styles.row2}>
            <div className={styles.field}>
              <label htmlFor="ac-price" className={styles.label}>Purchase price</label>
              <input
                id="ac-price"
                type="number"
                min={0}
                step="0.01"
                className={styles.input}
                placeholder="optional"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="ac-ccy" className={styles.label}>Currency</label>
              <select
                id="ac-ccy"
                className={styles.select}
                value={purchaseCurrency}
                onChange={(e) => setPurchaseCurrency(e.target.value as PurchaseCurrency)}
              >
                {PURCHASE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.field}>
            <label htmlFor="ac-date" className={styles.label}>Purchase date</label>
            <input
              id="ac-date"
              type="date"
              className={styles.input}
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="ac-notes" className={styles.label}>Notes</label>
            <textarea
              id="ac-notes"
              className={styles.textarea}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && <p className={styles.error}>{error}</p>}
          {tableMissing && (
            <p className={styles.notice}>
              Collections are almost ready — the shared database is being
              provisioned. Try again shortly.
            </p>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancel}
              onClick={props.onClose}
              disabled={isPending}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submit} disabled={!canSubmit}>
              {isPending ? 'Adding…' : 'Add to Collection'}
            </button>
          </div>
        </form>
      </div>
    </div>
    </DialogPortal>
  );
}
