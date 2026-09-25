'use client';

// Public/unlisted share bar. Two responsibilities:
//   1. Copy link (clipboard + native Web Share API when present).
//   2. Copy-to-My-Decks (server action; redirects logged-out users
//      through sign-in with a safe returnTo).

import { useState, useTransition } from 'react';
import { copySharedDeckAction } from '../decks/share-actions';
import styles from './SharedDeckRenderer.module.css';

interface Props {
  copySource:
    | { kind: 'public'; slug: string }
    | { kind: 'unlisted'; token: string };
  publicUrl: string | null;
  shareUrl: string | null;
}

export function ShareBar({ copySource, publicUrl, shareUrl }: Props) {
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState<'idle' | 'clipboard' | 'error'>('idle');

  const displayUrl = shareUrl ?? publicUrl;

  async function copyToClipboard() {
    if (!displayUrl) return;
    setCopied('idle');
    try {
      // Prefer native share on mobile, fall back to clipboard.
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.share) {
        await nav.share({ title: 'YGOPrices deck', url: displayUrl });
        setCopied('clipboard');
        return;
      }
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(displayUrl);
        setCopied('clipboard');
        return;
      }
      setCopied('error');
    } catch {
      setCopied('error');
    } finally {
      setTimeout(() => setCopied('idle'), 2000);
    }
  }

  return (
    <div className={styles.actions}>
      {displayUrl && (
        <button
          type="button"
          className={styles.shareBtn}
          onClick={copyToClipboard}
          title={displayUrl}
        >
          {copied === 'clipboard' ? 'Copied ✓' : copied === 'error' ? 'Copy failed' : 'Copy link'}
        </button>
      )}
      <form
        action={async () => {
          startTransition(async () => {
            await copySharedDeckAction(copySource);
          });
        }}
      >
        <button type="submit" className={styles.copyBtn} disabled={pending}>
          {pending ? 'Copying…' : '↳ Copy to My Decks'}
        </button>
      </form>
    </div>
  );
}
