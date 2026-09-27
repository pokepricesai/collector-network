// Reusable FAQ block with visible content + FAQPage JSON-LD.
//
// Mirrors the Lorcana + One Piece Faq components. Every question
// renders as a <details> element so the visible copy and the crawler
// JSON-LD stay in lockstep — no hidden schema stuffing.

import type { ReactNode } from 'react';

export interface FaqEntry {
  q: string;
  a: ReactNode;
  /** Plain-text version of the answer for JSON-LD (no HTML tags). */
  plainAnswer: string;
}

export interface FaqProps {
  title?: string;
  intro?: ReactNode;
  entries: readonly FaqEntry[];
  id?: string;
}

export function buildFaqJsonLd(entries: readonly FaqEntry[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.q,
      acceptedAnswer: { '@type': 'Answer', text: e.plainAnswer },
    })),
  };
}

export default function Faq({ title, intro, entries, id }: FaqProps) {
  if (entries.length === 0) return null;
  const ld = buildFaqJsonLd(entries);
  return (
    <section id={id ?? 'faq'} style={{ marginTop: 40, padding: '20px 0' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'var(--ygo-accent-gold-strong, #B78A0F)',
        marginBottom: 8,
      }}>FAQ</div>
      {title && (
        <h2 style={{ margin: '4px 0 6px', fontSize: 22, letterSpacing: '-0.01em' }}>
          {title}
        </h2>
      )}
      {intro && (
        <p style={{
          margin: '0 0 14px', color: 'var(--ygo-text-muted, #6B7280)',
          fontSize: 14, lineHeight: 1.55, maxWidth: 720,
        }}>{intro}</p>
      )}
      <div style={{ display: 'grid', gap: 8 }}>
        {entries.map((e, i) => (
          <details
            key={i}
            style={{
              border: '1px solid var(--ygo-border, #E5E7EB)',
              borderRadius: 10,
              background: 'var(--ygo-surface, #FFF)',
              padding: '10px 14px',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 14,
                color: 'var(--ygo-text-strong, #111827)',
                listStyle: 'none',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              {e.q}
              <span aria-hidden style={{ fontSize: 12, opacity: 0.6 }}>▾</span>
            </summary>
            <div style={{
              marginTop: 10, paddingTop: 10,
              borderTop: '1px solid var(--ygo-border, #E5E7EB)',
              fontSize: 14, lineHeight: 1.65,
              color: 'var(--ygo-text, #111827)',
            }}>
              {e.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
