'use client';

// WatchButton — toggle a watch on/off for an exact printing.
//
// Rules:
//   ▸ Printing pages: `fixedPrinting` supplied → one-click add/remove.
//   ▸ Card family pages: `availablePrintings` supplied → the user
//     picks a printing first (never watch a card without a printing).
//   ▸ Logged out: renders as a Link to /sign-in?returnTo=<here>.

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  addWatchAction,
  removeWatchByPrintingAction,
} from '../../app/watchlist/actions';
import { analytics } from '../../lib/analytics';
import { DialogPortal } from '../collection/DialogPortal';
import btnStyles from './WatchButton.module.css';
import dialogStyles from '../collection/AddToCollection.module.css';

export interface PrintingOption {
  id: string;
  label: string;
}

interface Props {
  isSignedIn: boolean;
  currentPathname: string;
  cardId: string;
  cardName: string;
  fixedPrinting?: PrintingOption;
  availablePrintings?: PrintingOption[];
  // If we already know the user watches this exact printing (only
  // meaningful when a fixed printing is supplied), pass true so we
  // render the "Watching" state on first paint.
  initiallyWatchingId?: string | null;
}

export function WatchButton(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [watching, setWatching] = useState<string | null>(
    props.initiallyWatchingId ?? null,
  );
  const [pending, startTransition] = useTransition();

  if (!props.isSignedIn) {
    const returnTo = encodeURIComponent(props.currentPathname);
    return (
      <Link href={`/sign-in?returnTo=${returnTo}`} className={btnStyles.trigger}>
        ☆ Watch
      </Link>
    );
  }

  // Fixed-printing one-click toggle.
  if (props.fixedPrinting) {
    const currentPid = props.fixedPrinting.id;
    const isWatching = watching === currentPid;
    return (
      <button
        type="button"
        className={
          isWatching
            ? `${btnStyles.trigger} ${btnStyles.triggerWatching}`
            : btnStyles.trigger
        }
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            if (isWatching) {
              const r = await removeWatchByPrintingAction(currentPid);
              if (r.ok) {
                analytics.removeFromWatchlist();
                setWatching(null);
                router.refresh();
              }
            } else {
              const r = await addWatchAction({
                tcg_card_id: props.cardId,
                tcg_printing_id: currentPid,
              });
              if (r.ok) {
                analytics.addToWatchlist();
                setWatching(currentPid);
                router.refresh();
              }
            }
          });
        }}
      >
        {pending ? '…' : isWatching ? '★ Watching' : '☆ Watch'}
      </button>
    );
  }

  // Family-page dialog picker.
  return (
    <>
      <button
        type="button"
        className={btnStyles.trigger}
        onClick={() => setOpen(true)}
      >
        ☆ Watch a printing
      </button>
      {open && (
        <PickPrintingDialog
          onClose={() => setOpen(false)}
          cardId={props.cardId}
          cardName={props.cardName}
          availablePrintings={props.availablePrintings ?? []}
        />
      )}
    </>
  );
}

interface DialogProps {
  onClose: () => void;
  cardId: string;
  cardName: string;
  availablePrintings: PrintingOption[];
}

function PickPrintingDialog(props: DialogProps) {
  const router = useRouter();
  const [printingId, setPrintingId] = useState('');
  const [target, setTarget] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'EUR'>('USD');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const canSubmit = useMemo(
    () => !pending && !!printingId,
    [pending, printingId],
  );

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await addWatchAction({
        tcg_card_id: props.cardId,
        tcg_printing_id: printingId,
        target_price: target.trim() ? Number(target) : null,
        target_currency: target.trim() ? currency : null,
        note: note.trim() || null,
      });
      if (r.ok) {
        props.onClose();
        router.refresh();
      } else if (r.tableMissing) {
        setError('Watchlists are almost ready - try again shortly.');
      } else {
        setError(r.error ?? 'Could not add to watchlist');
      }
    });
  }

  return (
    <DialogPortal>
      <div
        className={dialogStyles.backdrop}
        role="dialog"
        aria-modal="true"
        aria-label={`Watch ${props.cardName}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div className={dialogStyles.dialog}>
          <h2 className={dialogStyles.title}>Watch this card</h2>
          <div className={dialogStyles.cardLine}>
            <div>
              <p className={dialogStyles.cardName}>{props.cardName}</p>
              <p className={dialogStyles.cardMeta}>
                Watchlist entries pin to an exact printing so 7D / 30D / 90D
                movements never mix rarities or editions.
              </p>
            </div>
          </div>

          <form onSubmit={submit} className={dialogStyles.form}>
            <div className={dialogStyles.field}>
              <label htmlFor="wl-printing" className={dialogStyles.label}>
                Printing *
              </label>
              <select
                id="wl-printing"
                className={dialogStyles.select}
                value={printingId}
                onChange={(e) => setPrintingId(e.target.value)}
                required
              >
                <option value="">Choose a printing…</option>
                {props.availablePrintings.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={dialogStyles.row2}>
              <div className={dialogStyles.field}>
                <label htmlFor="wl-target" className={dialogStyles.label}>
                  Target price
                </label>
                <input
                  id="wl-target"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="optional"
                  className={dialogStyles.input}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </div>
              <div className={dialogStyles.field}>
                <label htmlFor="wl-currency" className={dialogStyles.label}>
                  Currency
                </label>
                <select
                  id="wl-currency"
                  className={dialogStyles.select}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as 'USD' | 'EUR')}
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>

            <div className={dialogStyles.field}>
              <label htmlFor="wl-note" className={dialogStyles.label}>
                Note
              </label>
              <textarea
                id="wl-note"
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
                onClick={props.onClose}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={dialogStyles.submit}
                disabled={!canSubmit}
              >
                {pending ? 'Watching…' : 'Watch this printing'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </DialogPortal>
  );
}
