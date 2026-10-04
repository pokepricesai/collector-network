// Visible FAQ block for the two card routes with FAQPage JSON-LD.
//
// Takes a plain-string entries array (CardFaqEntry[]) produced by the
// deterministic builders in `@/lib/card-faq`. The entries array is used
// as the single source of truth for both the DOM and the JSON-LD —
// never two separate copies.
//
// Answers may embed internal links via sentinel markers of the form
// `[[/path|label]]`. We parse those into Next.js <Link> nodes here;
// JSON-LD strips them back to plain text in `buildCardFaqJsonLd`.

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  buildCardFaqJsonLd,
  type CardFaqEntry,
} from '@/lib/card-faq';

interface CardFaqProps {
  title: string;
  entries: readonly CardFaqEntry[];
  /** Optional short intro paragraph above the questions. */
  intro?: string;
  /** Section id, defaults to `faq`. */
  id?: string;
}

export default function CardFaq({ title, entries, intro, id }: CardFaqProps) {
  if (entries.length === 0) return null;
  const ld = buildCardFaqJsonLd(entries);
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
      <h2 style={{ margin: '4px 0 6px', fontSize: 22, letterSpacing: '-0.01em' }}>
        {title}
      </h2>
      {intro && (
        <p
          style={{
            margin: '0 0 14px',
            color: 'var(--text-muted)',
            fontSize: 14,
            lineHeight: 1.55,
            maxWidth: 720,
          }}
        >
          {intro}
        </p>
      )}
      <dl style={{ display: 'grid', gap: 8, margin: 0 }}>
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
                listStyle: 'none',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <dt
                style={{
                  display: 'inline',
                  fontWeight: 700,
                  fontSize: 14,
                  color: 'var(--text-strong)',
                }}
              >
                {e.q}
              </dt>
              <span aria-hidden style={{ fontSize: 12, opacity: 0.6 }}>▾</span>
            </summary>
            <dd
              style={{
                margin: '10px 0 0',
                paddingTop: 10,
                borderTop: '1px solid var(--border)',
                fontSize: 14,
                lineHeight: 1.65,
                color: 'var(--text)',
              }}
            >
              {renderAnswer(e.a)}
            </dd>
          </details>
        ))}
      </dl>
    </section>
  );
}

/** Parse the answer string and replace `[[/path|label]]` with
 *  <Link href="/path">label</Link>. Non-sentinel text passes through. */
function renderAnswer(a: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(a)) !== null) {
    if (match.index > lastIndex) {
      parts.push(a.slice(lastIndex, match.index));
    }
    const href = match[1]!;
    const label = match[2]!;
    parts.push(
      <Link
        key={`l-${key++}`}
        href={href}
        style={{ color: 'var(--accent-2, var(--primary))', fontWeight: 600 }}
      >
        {label}
      </Link>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < a.length) parts.push(a.slice(lastIndex));
  return parts;
}
