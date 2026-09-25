'use client';

// Duplicate + delete action buttons on the deck library tiles. Kept
// as a small client leaf so the library page stays server-rendered.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DialogPortal } from '../../components/collection/DialogPortal';
import { deleteDeckAction, duplicateDeckAction } from './actions';
import dialogStyles from '../../components/collection/AddToCollection.module.css';
import styles from './Decks.module.css';

interface Props { deckId: string; deckName: string; }

export function DeckLibraryActions({ deckId, deckName }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className={styles.footerActions}>
      <button
        type="button"
        className={styles.actionBtn}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await duplicateDeckAction(deckId);
            if (r.ok && r.id) router.push(`/decks/${r.id}`);
          })
        }
      >
        {pending ? '…' : 'Duplicate'}
      </button>
      <button
        type="button"
        className={`${styles.actionBtn} ${styles.actionDelete}`}
        onClick={() => setConfirming(true)}
      >
        Delete
      </button>
      {confirming && (
        <ConfirmDelete
          deckId={deckId}
          deckName={deckName}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function ConfirmDelete({
  deckId,
  deckName,
  onClose,
}: {
  deckId: string;
  deckName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
          <h2 className={dialogStyles.title}>Delete this deck?</h2>
          <p style={{ fontSize: 13, color: 'var(--ygo-text-muted)', margin: '0 0 12px 0' }}>
            <strong>{deckName}</strong> and every card in it will be permanently
            removed. This cannot be undone.
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
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const r = await deleteDeckAction(deckId);
                  if (r.ok) {
                    onClose();
                    router.refresh();
                  } else {
                    setError(r.error ?? 'Delete failed');
                  }
                })
              }
            >
              {pending ? 'Deleting…' : 'Delete deck'}
            </button>
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}
