// Set-checklist completion surface for /collection.
//
// Renders the two headline counters (sets started, sets completed),
// a compact list of the closest-to-complete sets with progress bar +
// owned/total + percent, and each set expands to show the missing
// card list (capped). Missing card entries link to the underlying
// logical card page so the user can jump straight to Add-to-collection.

import Link from 'next/link';
import type { CompletionSummary, SetCompletionEntry } from '../../server/completion';

const TOP_N = 6;

export function SetCompletionSection({ completion }: { completion: CompletionSummary }) {
  const { setsStarted, setsCompleted, entries } = completion;
  const top = entries.slice(0, TOP_N);
  return (
    <section
      style={{
        marginBottom: 24,
        padding: 18,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontFamily: 'Outfit, system-ui, sans-serif', fontSize: 18 }}>
          Set checklist completion
        </h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text)' }}>{setsStarted}</strong> started
          {' · '}
          <strong style={{ color: 'var(--text)' }}>{setsCompleted}</strong> completed
        </span>
      </div>

      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 640 }}>
        Each set&apos;s checklist counts distinct base card-number slots.
        Owning the base printing OR any parallel / reprint of that slot
        fills it. Percentages never round up.
      </p>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
        {top.map((e) => (
          <SetCompletionRow key={e.set.id} entry={e} />
        ))}
      </ul>

      {entries.length > TOP_N && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          + {entries.length - TOP_N} more set(s) with progress.
        </div>
      )}
    </section>
  );
}

function SetCompletionRow({ entry }: { entry: SetCompletionEntry }) {
  const { set, totalSlots, ownedSlots, percent, missing, missingTotal } = entry;
  const setCode = set.code.toUpperCase();
  const complete = percent === 100;
  return (
    <li style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <details>
        <summary
          style={{
            cursor: 'pointer',
            listStyle: 'none',
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Link
                href={`/set/${encodeURIComponent(set.code.toLowerCase())}`}
                style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', textDecoration: 'none' }}
              >
                {set.name}
              </Link>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'ui-monospace, monospace',
                  color: 'var(--gold-600)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {setCode}
              </span>
              {complete && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'rgba(50, 168, 82, 0.18)',
                    color: '#3dd66a',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  Complete
                </span>
              )}
            </div>
            <div
              style={{
                marginTop: 6,
                height: 6,
                background: 'var(--border)',
                borderRadius: 3,
                overflow: 'hidden',
              }}
              aria-hidden
            >
              <div
                style={{
                  width: `${percent}%`,
                  height: '100%',
                  background: complete ? '#3dd66a' : 'var(--gold-600)',
                }}
              />
            </div>
          </div>
          <div style={{ textAlign: 'right', minWidth: 80 }}>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 700 }}>
              {ownedSlots} / {totalSlots}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
              {percent}%
            </div>
          </div>
        </summary>
        {!complete && missing.length > 0 && (
          <div style={{ marginTop: 10, paddingLeft: 4 }}>
            <div
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--text-muted)',
                marginBottom: 6,
              }}
            >
              Missing ({missingTotal})
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
              {missing.map((m) => (
                <li key={m.slot} style={{ fontSize: 13 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      minWidth: 84,
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 11,
                      color: 'var(--text-muted)',
                    }}
                  >
                    {m.slot}
                  </span>
                  <Link href={`/card/${m.slugName}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>
                    {m.cardName}
                  </Link>
                </li>
              ))}
            </ul>
            {missingTotal > missing.length && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                + {missingTotal - missing.length} more missing card(s).{' '}
                <Link
                  href={`/set/${encodeURIComponent(set.code.toLowerCase())}`}
                  style={{ color: 'var(--gold-600)' }}
                >
                  See full set
                </Link>
              </div>
            )}
          </div>
        )}
      </details>
    </li>
  );
}
