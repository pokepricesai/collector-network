import Link from 'next/link';

// Homepage "Explore Lorcana" strip. Ensures every primary hub is
// linked from the homepage — the Hero already exposes /card-finder
// and the deeper sections link out to /market and /inks, but
// /characters, /insights and /ai only appear in the sitewide navbar.
// Crawlers reading the homepage HTML get every primary destination
// with anchor text that describes what they are.

const HUBS: Array<{ href: string; label: string; hint: string }> = [
  { href: '/card-finder', label: 'Card Finder', hint: 'Filter by ink, rarity, type, inkability' },
  { href: '/characters',  label: 'Characters',  hint: 'Every character in the Lorcana catalogue' },
  { href: '/browse',      label: 'Sets',        hint: 'Every set with rarity mix and value' },
  { href: '/inks',        label: 'Inks',        hint: 'Amber, Amethyst, Emerald, Ruby, Sapphire, Steel' },
  { href: '/market',      label: 'Movers',      hint: 'Most valuable, biggest movers, chase tiers' },
  { href: '/insights',    label: 'Insights',    hint: 'Editorial deep-dives on the Lorcana market' },
  { href: '/ai',          label: 'Lorcana AI',  hint: 'Ask the AI about any card, printing or trend' },
];

export default function ExploreStrip() {
  return (
    <section
      aria-label="Explore Lorcana"
      className="lc-container"
      style={{ marginTop: 8, marginBottom: 8 }}
    >
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 14,
          background: 'var(--surface)',
          padding: 16,
        }}
      >
        <div
          className="label-mono"
          style={{ marginBottom: 10, color: 'var(--accent-2)' }}
        >
          Explore Lorcana
        </div>
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
            gap: 10,
          }}
        >
          {HUBS.map((hub) => (
            <li key={hub.href}>
              <Link
                href={hub.href}
                style={{
                  display: 'block',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-light, var(--surface))',
                  textDecoration: 'none',
                  color: 'var(--text)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {hub.label} →
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    marginTop: 2,
                  }}
                >
                  {hub.hint}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
