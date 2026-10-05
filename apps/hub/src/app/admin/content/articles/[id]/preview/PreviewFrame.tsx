'use client';

// Chrome (top bar + viewport frame + SEO panel) around the server-
// rendered site preview. Receives the already-rendered article shell
// as `children` so the preview DOM lives inside a scrollable frame
// with a fixed max-width.
//
// Switching target / viewport is navigation, not a client swap — this
// keeps each render fully SSR and the preview DOM identical to what
// the real site would serve.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  TARGET_LABELS,
  VIEWPORT_PX,
  type PreviewTarget,
  type PreviewViewport,
} from '@/components/content-preview/types';

export interface PreviewFrameProps {
  articleId: string;
  target: PreviewTarget;
  viewport: PreviewViewport;
  seo: {
    title: string;
    metaTitle: string | null;
    metaDescription: string | null;
    slug: string;
    canonicalUrlPrediction: string;
    featuredImageUrl: string | null;
    ogImageUrl: string | null;
    siteName: string;
  };
  isDirtyNote: string | null;
  children: React.ReactNode;
}

const TARGETS: PreviewTarget[] = [
  'pokeprices_external',
  'mtgprices_markdown',
  'ygo_db',
  'onepiece_db',
  'lorcana_db',
];

export function PreviewFrame({
  articleId,
  target,
  viewport,
  seo,
  isDirtyNote,
  children,
}: PreviewFrameProps) {
  const router = useRouter();
  const search = useSearchParams();
  const [, start] = useTransition();
  const [seoOpen, setSeoOpen] = useState(false);

  const setParam = (key: 'target' | 'viewport', value: string) => {
    const next = new URLSearchParams(search?.toString() ?? '');
    next.set(key, value);
    start(() => router.replace(`?${next.toString()}`, { scroll: false }));
  };

  const widthPx = VIEWPORT_PX[viewport];

  return (
    <div className="preview-root">
      <header className="preview-chrome">
        <Link href={`/admin/content/articles/${articleId}`} className="preview-chrome-back">
          ← Editor
        </Link>
        <span className="preview-chrome-divider">·</span>
        <span className="preview-chrome-eyebrow">Preview</span>

        <div className="preview-chrome-group" role="tablist" aria-label="Site target">
          {TARGETS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === target}
              onClick={() => setParam('target', t)}
              className={`preview-chrome-btn${t === target ? ' is-active' : ''}`}
            >
              {TARGET_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="preview-chrome-group preview-chrome-group--right" role="tablist" aria-label="Viewport">
          {(['desktop', 'mobile'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={v === viewport}
              onClick={() => setParam('viewport', v)}
              className={`preview-chrome-btn${v === viewport ? ' is-active' : ''}`}
            >
              {v === 'desktop' ? 'Desktop' : 'Mobile'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSeoOpen((o) => !o)}
            aria-pressed={seoOpen}
            className={`preview-chrome-btn${seoOpen ? ' is-active' : ''}`}
          >
            SEO
          </button>
        </div>
      </header>

      {isDirtyNote && (
        <div className="preview-dirty-banner" role="status">{isDirtyNote}</div>
      )}

      {seoOpen && (
        <aside className="preview-seo-panel">
          <SeoField label="Site target">{seo.siteName}</SeoField>
          <SeoField label="Slug"><code>{seo.slug}</code></SeoField>
          <SeoField label="Canonical URL">
            <a href={seo.canonicalUrlPrediction} target="_blank" rel="noopener noreferrer">
              {seo.canonicalUrlPrediction}
            </a>
          </SeoField>
          <SeoField label="Title">{seo.title}</SeoField>
          <SeoField label="Meta title">{seo.metaTitle ?? <em>falls back to title</em>}</SeoField>
          <SeoField label="Meta description">
            {seo.metaDescription ?? <em>falls back to summary</em>}
          </SeoField>
          <SeoField label="Featured image">
            {seo.featuredImageUrl ? (
              <a href={seo.featuredImageUrl} target="_blank" rel="noopener noreferrer">
                {seo.featuredImageUrl.replace(/^.*\//, '')}
              </a>
            ) : <em>none</em>}
          </SeoField>
          <SeoField label="OG image">
            {seo.ogImageUrl
              ? <a href={seo.ogImageUrl} target="_blank" rel="noopener noreferrer">{seo.ogImageUrl.replace(/^.*\//, '')}</a>
              : <em>uses featured</em>}
          </SeoField>
        </aside>
      )}

      <div className={`preview-canvas${viewport === 'mobile' ? ' preview-canvas--mobile' : ''}`}>
        <div className="preview-canvas-frame" style={{ maxWidth: widthPx }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function SeoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="preview-seo-field">
      <div>{label}</div>
      <div>{children}</div>
    </div>
  );
}
