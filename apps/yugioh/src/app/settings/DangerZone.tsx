'use client';

// Danger zone. YGO-scope deletion only: wipes the user's YGO
// user_metadata namespace (profile + preferences) and signs them
// out. Never touches auth.users because that identity is shared
// across every Collector Network site.
//
// Future Slice D/E/F additions (collection items, watchlist,
// deck rows) plug in via the deleteYgoData() call site — the
// server action is designed to accept every future YGO-owned table
// name as it's added.

import { useState } from 'react';
import { createBrowserSupabase } from '@collector-network/auth';
import styles from '../account/Account.module.css';

const REQUIRED = 'DELETE';

export function DangerZone() {
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onDelete() {
    setError(null);
    setPending(true);
    try {
      const supabase = createBrowserSupabase();
      // Wipe every YGO-owned key in user_metadata. When Slice D/E/F
      // add their own row-level tables the caller extends this
      // to also delete those rows before signing out.
      const { error: metaError } = await supabase.auth.updateUser({
        data: { ygo: null },
      });
      if (metaError) throw metaError;
      // Sign the user out — they can create a fresh YGOPrices
      // profile at will since auth.users is untouched.
      const { error: outErr } = await supabase.auth.signOut();
      if (outErr) throw outErr;
      setDone(true);
      // Send them home. Full reload so cached RSC data clears.
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.danger}>
      <h3 className={styles.dangerTitle}>Delete YGOPrices data</h3>
      <p className={styles.sectionCaption}>
        Removes your YGOPrices display name, avatar and preferences from
        this account. Your Collector Network sign-in (shared across
        PokePrices, MTGPrices and any other network site) is not affected;
        you can create a fresh YGOPrices profile any time.
      </p>
      <p className={styles.sectionCaption} style={{ marginBottom: 8 }}>
        Type <strong>{REQUIRED}</strong> to enable the button.
      </p>
      <input
        type="text"
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        className={styles.input}
        placeholder="Type DELETE"
        aria-label="Confirmation"
      />
      {error && <p className={styles.error} style={{ marginTop: 8 }}>{error}</p>}
      <button
        type="button"
        onClick={onDelete}
        className={styles.dangerSubmit}
        disabled={confirmation.trim() !== REQUIRED || pending || done}
      >
        {done ? 'Deleted' : pending ? 'Deleting…' : 'Delete YGOPrices data'}
      </button>
    </div>
  );
}
