'use client';

// Owner sharing controls. Sits alongside the deck stats panel in
// the builder sidebar. Handles:
//   • visibility toggle (Private / Unlisted / Public)
//   • Copy public link
//   • Copy unlisted link + Regenerate

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  regenerateTokenAction,
  setVisibilityAction,
} from '../share-actions';
import { analytics } from '../../../lib/analytics';
import type { Visibility } from '../../../lib/deck-sharing';
import styles from './SharingPanel.module.css';

interface Props {
  deckId: string;
  visibility: Visibility;
  publicSlug: string | null;
  shareToken: string | null;
  siteOrigin: string; // absolute origin string from server
}

export function SharingPanel(props: Props) {
  const router = useRouter();
  const [visibility, setVisibility] = useState<Visibility>(props.visibility);
  const [publicSlug, setPublicSlug] = useState(props.publicSlug);
  const [shareToken, setShareToken] = useState(props.shareToken);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<null | 'public' | 'share'>(null);

  // Sync local state whenever the server re-renders with fresh props
  // (e.g. after a rename triggers syncPublicSlugAfterRename in the
  // builder's rename effect). Without this the sidebar shows a stale
  // URL until the user hits refresh.
  useEffect(() => {
    setVisibility(props.visibility);
    setPublicSlug(props.publicSlug);
    setShareToken(props.shareToken);
  }, [props.visibility, props.publicSlug, props.shareToken]);

  function change(next: Visibility) {
    setError(null);
    startTransition(async () => {
      const r = await setVisibilityAction(props.deckId, next);
      if (!r.ok) {
        setError(r.error ?? 'Could not change visibility');
        return;
      }
      if (r.visibility === 'public' || r.visibility === 'unlisted') {
        // Fire only on transitions INTO a shared state so we don't
        // count every private->private no-op or private-clean-up.
        if (props.visibility !== r.visibility) {
          analytics.deckPublished({ visibility: r.visibility });
        }
      }
      setVisibility(r.visibility ?? next);
      setPublicSlug(r.public_slug ?? null);
      setShareToken(r.share_token ?? null);
      router.refresh();
    });
  }

  function rotate() {
    setError(null);
    startTransition(async () => {
      const r = await regenerateTokenAction(props.deckId);
      if (!r.ok) {
        setError(r.error ?? 'Could not regenerate');
        return;
      }
      setShareToken(r.share_token ?? null);
      router.refresh();
    });
  }

  async function copy(url: string, which: 'public' | 'share') {
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.share) {
        try {
          await nav.share({ title: 'YGOPrices deck', url });
          setCopied(which);
        } catch {
          if (nav.clipboard?.writeText) {
            await nav.clipboard.writeText(url);
            setCopied(which);
          }
        }
      } else if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(url);
        setCopied(which);
      }
    } finally {
      setTimeout(() => setCopied(null), 2000);
    }
  }

  const publicUrl = publicSlug ? `${props.siteOrigin}/deck/${encodeURIComponent(publicSlug)}` : null;
  const shareUrl = shareToken ? `${props.siteOrigin}/deck/share/${encodeURIComponent(shareToken)}` : null;

  return (
    <section className={styles.wrap}>
      <h3 className={styles.title}>Sharing</h3>
      <p className={styles.caption}>
        Private stays owner-only. Unlisted works only with the correct
        share URL and is never indexed. Public is discoverable and
        indexable - the URL stays stable when you rename.
      </p>

      <div className={styles.pills} role="tablist" aria-label="Visibility">
        {(['private', 'unlisted', 'public'] as Visibility[]).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={visibility === v}
            className={`${styles.pill} ${visibility === v ? styles.pillActive : ''}`}
            onClick={() => change(v)}
            disabled={pending}
          >
            {v}
          </button>
        ))}
      </div>

      {visibility === 'unlisted' && shareUrl && (
        <>
          <div className={styles.linkRow}>
            <span className={styles.linkText} title={shareUrl}>{shareUrl}</span>
            <button
              type="button"
              className={`${styles.mini} ${styles.miniPrimary}`}
              onClick={() => copy(shareUrl, 'share')}
            >
              {copied === 'share' ? 'Copied ✓' : 'Copy'}
            </button>
            <button type="button" className={styles.mini} onClick={rotate} disabled={pending}>
              Regenerate
            </button>
          </div>
          <p className={styles.caption}>
            Regenerating rotates the token; the old URL stops working
            immediately.
          </p>
        </>
      )}

      {visibility === 'public' && publicUrl && (
        <>
          <div className={styles.linkRow}>
            <span className={styles.linkText} title={publicUrl}>{publicUrl}</span>
            <button
              type="button"
              className={`${styles.mini} ${styles.miniPrimary}`}
              onClick={() => copy(publicUrl, 'public')}
            >
              {copied === 'public' ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <p className={styles.caption}>
            Public URL includes an immutable suffix so it stays stable
            when you rename the deck.
          </p>
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
