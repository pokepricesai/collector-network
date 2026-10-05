'use client';

// Chrome (top bar + viewport frame + SEO panel) around the server-
// rendered site preview. Receives the already-rendered article shell
// as `children` so the preview DOM lives inside a scrollable iframe-
// like container with a fixed max-width.
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
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#1A1A1A' }}>
      {/* Chrome bar */}
      <header style={{
        padding: '10px 16px',
        background: '#141414',
        color: '#F2F2F2',
        borderBottom: '1px solid #2A2A2A',
        display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}>
        <Link
          href={`/admin/content/articles/${articleId}`}
          style={{ color: '#AAA', textDecoration: 'none', fontSize: 12 }}
        >
          ← Editor
        </Link>
        <span style={{ color: '#555' }}>|</span>
        <span style={{ fontSize: 11, color: '#AAA', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Preview
        </span>

        {/* Target switcher */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 10 }}>
          {TARGETS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setParam('target', t)}
              style={{
                background: t === target ? '#F2F2F2' : 'transparent',
                color: t === target ? '#141414' : '#CCC',
                border: '1px solid #333',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {TARGET_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Viewport switcher */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {(['desktop', 'mobile'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setParam('viewport', v)}
              style={{
                background: v === viewport ? '#F2F2F2' : 'transparent',
                color: v === viewport ? '#141414' : '#CCC',
                border: '1px solid #333',
                borderRadius: 4,
                padding: '4px 10px',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textTransform: 'capitalize',
              }}
            >
              {v === 'desktop' ? `Desktop (${VIEWPORT_PX.desktop}px)` : `Mobile (${VIEWPORT_PX.mobile}px)`}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSeoOpen((o) => !o)}
            style={{
              background: seoOpen ? '#F2F2F2' : 'transparent',
              color: seoOpen ? '#141414' : '#CCC',
              border: '1px solid #333',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            SEO
          </button>
        </div>
      </header>

      {/* Optional dirty banner */}
      {isDirtyNote && (
        <div style={{
          padding: '8px 16px',
          background: '#8A6A1C',
          color: '#FFF9E6',
          fontSize: 12,
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}>
          {isDirtyNote}
        </div>
      )}

      {/* Optional SEO panel */}
      {seoOpen && (
        <aside style={{
          padding: '14px 20px',
          background: '#F5F5F0',
          borderBottom: '1px solid #D4D4D4',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 14,
          fontSize: 12,
          color: '#333',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}>
          <SeoField label="Site target">{seo.siteName}</SeoField>
          <SeoField label="Slug"><code>{seo.slug}</code></SeoField>
          <SeoField label="Canonical URL prediction">
            <a href={seo.canonicalUrlPrediction} target="_blank" rel="noopener noreferrer" style={{ color: '#1A3A7B' }}>
              {seo.canonicalUrlPrediction}
            </a>
          </SeoField>
          <SeoField label="Title">{seo.title}</SeoField>
          <SeoField label="Meta title">{seo.metaTitle ?? <span style={{ color: '#888' }}>(falls back to title)</span>}</SeoField>
          <SeoField label="Meta description">
            {seo.metaDescription ?? <span style={{ color: '#888' }}>(falls back to summary)</span>}
          </SeoField>
          <SeoField label="Featured image">
            {seo.featuredImageUrl ? (
              <a href={seo.featuredImageUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1A3A7B' }}>
                {seo.featuredImageUrl.replace(/^.*\//, '')}
              </a>
            ) : <span style={{ color: '#888' }}>(none)</span>}
          </SeoField>
          <SeoField label="OG image">
            {seo.ogImageUrl
              ? <a href={seo.ogImageUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#1A3A7B' }}>{seo.ogImageUrl.replace(/^.*\//, '')}</a>
              : <span style={{ color: '#888' }}>(uses featured)</span>}
          </SeoField>
        </aside>
      )}

      {/* Viewport frame */}
      <div style={{
        flex: 1,
        padding: viewport === 'mobile' ? '20px 10px 40px' : '20px 20px 40px',
        display: 'flex',
        justifyContent: 'center',
        overflow: 'auto',
      }}>
        <div style={{
          width: '100%',
          maxWidth: widthPx,
          background: '#FFFFFF',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
          borderRadius: 6,
          overflow: 'hidden',
          transition: 'max-width 220ms ease',
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function SeoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#777', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ wordBreak: 'break-word' }}>{children}</div>
    </div>
  );
}
