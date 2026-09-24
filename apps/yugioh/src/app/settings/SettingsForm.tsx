'use client';

// Settings — profile + preferences. Uses the browser Supabase client
// to write user_metadata (the caller's own session, RLS trivial).
// The delete flow lives in the parent server component and posts to
// a server action.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabase } from '@collector-network/auth';
import { Avatar } from '../../components/account/Avatar';
import {
  AVATAR_KEYS,
  CURRENCIES,
  GRADERS,
  PRICE_DISPLAY_MODES,
  buildProfilePatch,
  sanitiseDisplayName,
  type AvatarKey,
  type PreferredCurrency,
  type PreferredGrader,
  type PriceDisplayMode,
  type YgoProfile,
} from '../../lib/user-profile';
import styles from '../account/Account.module.css';

interface Props {
  initial: YgoProfile;
}

export function SettingsForm({ initial }: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [avatarKey, setAvatarKey] = useState<AvatarKey>(initial.avatarKey);
  const [preferredCurrency, setPreferredCurrency] = useState<PreferredCurrency>(
    initial.preferredCurrency,
  );
  const [priceDisplay, setPriceDisplay] = useState<PriceDisplayMode>(
    initial.priceDisplay,
  );
  const [preferredGrader, setPreferredGrader] = useState<PreferredGrader>(
    initial.preferredGrader,
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice(null);
    setError(null);
    setSaving(true);
    try {
      const supabase = createBrowserSupabase();
      const patch = buildProfilePatch({
        displayName,
        avatarKey,
        preferredCurrency,
        priceDisplay,
        preferredGrader,
      });
      const { error } = await supabase.auth.updateUser({ data: patch });
      if (error) throw error;
      setNotice('Saved.');
      // Refresh the RSC so the header + account page pick up the new
      // display-name/avatar immediately.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="displayName" className={styles.label}>
          Display name
        </label>
        <input
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(sanitiseDisplayName(e.target.value))}
          maxLength={60}
          className={styles.input}
          placeholder="Duelist"
        />
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Avatar</span>
        <div className={styles.avatarRow}>
          {AVATAR_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className={`${styles.avatarChoice} ${
                avatarKey === k ? styles.avatarChoiceActive : ''
              }`}
              onClick={() => setAvatarKey(k)}
              aria-pressed={avatarKey === k}
              aria-label={k}
            >
              <Avatar avatarKey={k} size={44} />
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="currency" className={styles.label}>
          Preferred currency
        </label>
        <select
          id="currency"
          value={preferredCurrency}
          onChange={(e) => setPreferredCurrency(e.target.value as PreferredCurrency)}
          className={styles.select}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="priceDisplay" className={styles.label}>
          Price display
        </label>
        <select
          id="priceDisplay"
          value={priceDisplay}
          onChange={(e) => setPriceDisplay(e.target.value as PriceDisplayMode)}
          className={styles.select}
        >
          <option value="raw-and-graded">Raw and graded (default)</option>
          <option value="raw-only">Raw only</option>
          <option value="graded-only">Graded only</option>
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="grader" className={styles.label}>
          Preferred grader
        </label>
        <select
          id="grader"
          value={preferredGrader}
          onChange={(e) => setPreferredGrader(e.target.value as PreferredGrader)}
          className={styles.select}
        >
          {GRADERS.map((g) => (
            <option key={g} value={g}>
              {g.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className={styles.error}>{error}</p>}

      <button type="submit" className={styles.submit} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
