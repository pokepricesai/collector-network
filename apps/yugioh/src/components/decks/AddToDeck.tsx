'use client';

// Add-to-Deck picker for card + printing pages. Opens a modal
// listing the caller's decks; each row exposes Main / Extra / Side
// buttons. The click routes through the Slice F server action so
// F&L caps, section placement, and identity resolution stay
// authoritative on the server.
//
// Rules:
//   • printing page: caller passes tcg_printing_id so the server
//     both resolves the identity AND sets the printing as the
//     preferred printing on the deck row (spec §14 - preferred
//     printing does not affect legality; §3 - printing page's
//     preferred printing may match).
//   • card family page: caller passes card_name and does not set a
//     preferred printing.
//
// Logged out: renders a link to /sign-in with a safe returnTo.

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  addCardToDeckAction,
  listMyDecksForPickerAction,
} from '../../app/decks/add-to-deck-action';
import { DialogPortal } from '../collection/DialogPortal';
import btnStyles from '../watchlist/WatchButton.module.css';
import dialogStyles from '../collection/AddToCollection.module.css';
import styles from './AddToDeck.module.css';

interface Props {
  isSignedIn: boolean;
  currentPathname: string;
  cardName: string;
  // Exactly one of tcg_printing_id or card_name should be authoritative
  // for identity. tcg_printing_id wins when both are present so we
  // also set the preferred printing.
  tcgPrintingId?: string;
  // Extra Deck cards can only go in Extra or Side; regular cards
  // in Main or Side. The picker uses this to disable inappropriate
  // section buttons.
  extraOnly?: boolean;
}

export function AddToDeck(props: Props) {
  const [open, setOpen] = useState(false);
  if (!props.isSignedIn) {
    const returnTo = encodeURIComponent(props.currentPathname);
    return (
      <Link href={`/sign-in?returnTo=${returnTo}`} className={btnStyles.trigger}>
        + Add to Deck
      </Link>
    );
  }
  return (
    <>
      <button
        type="button"
        className={btnStyles.trigger}
        onClick={() => setOpen(true)}
      >
        + Add to Deck
      </button>
      {open && (
        <Dialog
          onClose={() => setOpen(false)}
          cardName={props.cardName}
          tcgPrintingId={props.tcgPrintingId}
          extraOnly={props.extraOnly}
        />
      )}
    </>
  );
}

interface DialogProps {
  onClose: () => void;
  cardName: string;
  tcgPrintingId?: string;
  extraOnly?: boolean;
}

interface DeckPickerItem {
  id: string;
  name: string;
  main: number;
  extra: number;
  side: number;
  state: 'incomplete' | 'legal' | 'illegal';
}

function Dialog({ onClose, cardName, tcgPrintingId, extraOnly }: DialogProps) {
  const router = useRouter();
  const [decks, setDecks] = useState<DeckPickerItem[] | null>(null);
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'ok'; msg: string } | { kind: 'err'; msg: string }>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);

  // Fetch decks once when the dialog opens. Dialog only mounts on
  // open so this is a genuine one-shot.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await listMyDecksForPickerAction();
      if (cancelled) return;
      setLoading(false);
      if (r.tableMissing) setTableMissing(true);
      else if (r.signedOut) setSignedOut(true);
      else if (r.ok) setDecks(r.decks ?? []);
      else if (r.error) setStatus({ kind: 'err', msg: r.error });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function add(deckId: string, section: 'main' | 'extra' | 'side') {
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      const r = await addCardToDeckAction(deckId, {
        card_name: cardName,
        tcg_printing_id: tcgPrintingId,
        section,
        preferred_tcg_printing_id: tcgPrintingId ?? null,
      });
      if (r.ok) {
        setStatus({ kind: 'ok', msg: `Added to ${section === 'main' ? 'Main' : section === 'extra' ? 'Extra' : 'Side'}` });
        // Bump the deck's section count optimistically so the picker
        // shows the change without a full refetch.
        setDecks((prev) =>
          prev?.map((d) => {
            if (d.id !== deckId) return d;
            return {
              ...d,
              main: section === 'main' ? d.main + 1 : d.main,
              extra: section === 'extra' ? d.extra + 1 : d.extra,
              side: section === 'side' ? d.side + 1 : d.side,
            };
          }) ?? prev,
        );
        router.refresh();
      } else {
        setStatus({ kind: 'err', msg: r.error ?? 'Could not add card' });
      }
    });
  }

  return (
    <DialogPortal>
      <div
        className={dialogStyles.backdrop}
        role="dialog"
        aria-modal="true"
        aria-label={`Add ${cardName} to a deck`}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className={dialogStyles.dialog}>
          <h2 className={dialogStyles.title}>Add to Deck</h2>
          <div className={dialogStyles.cardLine}>
            <div>
              <p className={dialogStyles.cardName}>{cardName}</p>
              <p className={dialogStyles.cardMeta}>
                Gameplay identity is card-family based. Adding from a printing
                page will also set that printing as the deck row&apos;s preferred
                printing for display and value.
              </p>
            </div>
          </div>

          {loading && <div className={styles.emptyList}>Loading your decks...</div>}
          {tableMissing && (
            <div className={styles.emptyList}>
              Decks storage is being provisioned. Try again shortly.
            </div>
          )}
          {signedOut && (
            <div className={styles.emptyList}>Please sign in to add cards to decks.</div>
          )}
          {!loading && !tableMissing && !signedOut && decks && decks.length === 0 && (
            <div className={styles.emptyList}>
              You have no decks yet.
              <br />
              <Link href="/decks/new" className={styles.newDeckLink}>
                Create your first deck
              </Link>
            </div>
          )}
          {!loading && decks && decks.length > 0 && (
            <div className={styles.deckList}>
              {decks.map((d) => (
                <div key={d.id} className={styles.deckRow}>
                  <div>
                    <div className={styles.deckName}>{d.name}</div>
                    <div className={styles.deckMeta}>
                      Main {d.main} · Extra {d.extra} · Side {d.side} · {d.state}
                    </div>
                  </div>
                  <div className={styles.sectionBtns}>
                    <button
                      type="button"
                      className={styles.sectionBtn}
                      disabled={pending || extraOnly}
                      onClick={() => add(d.id, 'main')}
                      title={extraOnly ? 'Extra-Deck monsters cannot go in Main' : 'Add to Main'}
                    >
                      + Main
                    </button>
                    <button
                      type="button"
                      className={styles.sectionBtn}
                      disabled={pending || !extraOnly}
                      onClick={() => add(d.id, 'extra')}
                      title={extraOnly ? 'Add to Extra' : 'Only Extra-Deck monsters can go here'}
                    >
                      + Extra
                    </button>
                    <button
                      type="button"
                      className={styles.sectionBtn}
                      disabled={pending}
                      onClick={() => add(d.id, 'side')}
                      title="Add to Side"
                    >
                      + Side
                    </button>
                  </div>
                </div>
              ))}
              <Link href="/decks/new" className={styles.newDeckLink}>
                + Create a new deck
              </Link>
            </div>
          )}

          {status.kind !== 'idle' && (
            <p
              className={`${styles.status} ${
                status.kind === 'ok' ? styles.statusOk : styles.statusError
              }`}
            >
              {status.msg}
            </p>
          )}

          <div className={dialogStyles.actions}>
            <button
              type="button"
              className={dialogStyles.cancel}
              onClick={onClose}
              disabled={pending}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}
