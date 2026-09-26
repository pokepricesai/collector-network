import Link from 'next/link';
import { LC_INKS, LC_INK_LABEL, LC_INK_DESCRIPTOR } from '@/lib/lorcana/ink';

// Discovery band for the six Lorcana inks. Each ink is a genuine
// deckbuilding + collector filter, so we make the top-level
// entrypoints visually distinctive rather than showing six
// identical cards.

export default function InksExplorer() {
  return (
    <section className="lc-section" style={{ background: 'var(--surface-inset)', borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)' }}>
      <div className="lc-container">
        <header style={{ marginBottom: 20, display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div className="label-mono">The six inks</div>
            <h2 style={{ margin: '4px 0 0' }}>Browse by ink colour</h2>
          </div>
          <Link href="/inks" className="btn btn-ghost btn-sm">All inks →</Link>
        </header>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
          gap: 12,
        }}>
          {LC_INKS.map((ink) => (
            <Link
              key={ink}
              href={`/inks/${ink}`}
              className="lc-hover"
              data-ink={ink}
              style={{
                display: 'block',
                padding: 16,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                textDecoration: 'none',
                color: 'var(--text)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{
                position: 'absolute', inset: 0,
                background: `radial-gradient(120% 80% at 100% 0%, var(--ink-${ink}) 0%, transparent 45%)`,
                opacity: 0.10,
                pointerEvents: 'none',
              }} aria-hidden />
              <div style={{ position: 'relative', display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                <span aria-hidden style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: `var(--ink-${ink})`,
                  boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.10)',
                }} />
                <span style={{ fontWeight: 800, fontSize: 17, fontFamily: 'Outfit, sans-serif' }}>
                  {LC_INK_LABEL[ink]}
                </span>
              </div>
              <div style={{ position: 'relative', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
                {LC_INK_DESCRIPTOR[ink]}
              </div>
              <div style={{ position: 'relative', marginTop: 12, fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
                Open ink →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
