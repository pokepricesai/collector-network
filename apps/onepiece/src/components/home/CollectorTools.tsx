import Link from 'next/link';

// Static tools band. Same shape as MTGPrices' "collector tools" strip
// with OP-native contents.

const TOOLS = [
  {
    title: 'Card Finder',
    description:
      'Filter by colour, cost, power, counter, life, attribute, trigger, type/crew and language.',
    href: '/card-finder',
    accent: 'ocean' as const,
  },
  {
    title: 'Movers Board',
    description:
      '7-, 30- and 90-day movers filtered to signal — headline price ≥ $2 with three or more observations.',
    href: '/market',
    accent: 'gold' as const,
  },
  {
    title: 'Leaders Directory',
    description:
      'Every Leader card in the catalogue, grouped by colour pair and sortable by set value.',
    href: '/leaders',
    accent: 'coral' as const,
  },
];

export default function CollectorTools() {
  return (
    <section className="ivory-band" style={{ padding: '48px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', position: 'relative' }}>
        <div style={{ marginBottom: 20 }}>
          <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
            Collector tools
          </div>
          <h2 style={{ fontSize: 28, margin: '4px 0 0' }}>
            Search deeper. Buy smarter.
          </h2>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
            gap: 14,
          }}
        >
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="card-hover card-hover-gold"
              style={{
                display: 'grid',
                gap: 10,
                padding: 20,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                textDecoration: 'none',
                color: 'var(--text)',
              }}
            >
              <span
                className={
                  tool.accent === 'gold'
                    ? 'chip chip-gold'
                    : tool.accent === 'coral'
                      ? 'chip chip-coral'
                      : 'chip chip-ocean'
                }
                style={{ width: 'fit-content' }}
              >
                {tool.title}
              </span>
              <p
                style={{
                  margin: 0,
                  color: 'var(--text-muted)',
                  fontSize: 14,
                  lineHeight: 1.55,
                }}
              >
                {tool.description}
              </p>
              <span style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 13 }}>
                Open →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
