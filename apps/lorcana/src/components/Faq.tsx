// Reusable FAQ block with visible content + FAQPage JSON-LD.
//
// Design intent:
//   * Every question renders as a visible <details> element so users
//     see the same Q/A that the JSON-LD advertises. No hidden schema
//     stuffing.
//   * Answers accept React nodes so internal links stay natural.
//   * `structured` computes the JSON-LD payload from the exact same
//     text the reader sees (strips React nodes to plain text for the
//     acceptedAnswer.text field via a caller-supplied `plainAnswer`).
//
// Callers pass entries as { q, a, plainAnswer } — `a` renders to
// screen, `plainAnswer` is the crawlable JSON-LD version.

import type { ReactNode } from 'react';

export interface FaqEntry {
  q: string;
  a: ReactNode;
  /** Plain-text version of the answer for JSON-LD. Must not contain
   *  HTML tags. Keep the semantic meaning identical to `a`. */
  plainAnswer: string;
}

export interface FaqProps {
  title?: string;
  intro?: ReactNode;
  entries: readonly FaqEntry[];
  /** Optional slug/id for section anchors. */
  id?: string;
}

/** Build the FAQPage JSON-LD payload (schema.org). */
export function buildFaqJsonLd(entries: readonly FaqEntry[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: e.plainAnswer,
      },
    })),
  };
}

export default function Faq({ title, intro, entries, id }: FaqProps) {
  if (entries.length === 0) return null;
  const ld = buildFaqJsonLd(entries);
  return (
    <section
      id={id ?? 'faq'}
      style={{
        marginTop: 40,
        padding: '20px 0',
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />
      <div className="label-mono" style={{ marginBottom: 8 }}>FAQ</div>
      {title && (
        <h2 style={{ margin: '4px 0 6px', fontSize: 22, letterSpacing: '-0.01em' }}>
          {title}
        </h2>
      )}
      {intro && (
        <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55, maxWidth: 720 }}>
          {intro}
        </p>
      )}
      <div style={{ display: 'grid', gap: 8 }}>
        {entries.map((e, i) => (
          <details
            key={i}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 10,
              background: 'var(--surface)',
              padding: '10px 14px',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 14,
                color: 'var(--text-strong)',
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
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: '1px solid var(--border)',
                fontSize: 14,
                lineHeight: 1.65,
                color: 'var(--text)',
              }}
            >
              {e.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
