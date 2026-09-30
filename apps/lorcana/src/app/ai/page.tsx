import type { Metadata } from 'next';
import Link from 'next/link';
import { canonicalFor } from '../../lib/seo';

// /ai — discovery page for Lorcana AI. The AI itself runs on every
// card page (see components/card/AskLorcanaPanel.tsx). This page
// exists so the "AI" nav entry is a real destination that explains
// what the feature does and directs collectors to the surface where
// it lives. We do NOT ship a second AI system.

export const revalidate = 86_400;

export const metadata: Metadata = {
  title: 'Lorcana AI — ask questions about any Lorcana card',
  description:
    'Ask the Lorcana AI about any card in the catalogue. Grounded in the same data that powers the rest of LorcanaPrices — sets, rarities, prices, effects, characters. Open any card and use the AI panel to ask a question.',
  alternates: { canonical: canonicalFor('/ai') },
};

const FEATURED: { name: string; slug: string; blurb: string }[] = [
  { name: 'Elsa - Spirit of Winter', slug: 'elsa-spirit-of-winter',
    blurb: 'Iconic Amethyst dragon. Ask about her lore rate, banned combos, and iconic play patterns.' },
  { name: 'Mickey Mouse - Brave Little Tailor', slug: 'mickey-mouse-brave-little-tailor',
    blurb: 'Storyborn hero. Ask about competitive builds, best inks, and which sets he shows up in.' },
  { name: 'Maleficent - Sorceress', slug: 'maleficent-sorceress',
    blurb: 'Chase Enchanted card. Ask about market history and how to identify legit copies.' },
  { name: 'Beast - Hardheaded', slug: 'beast-hardheaded',
    blurb: 'Ruby aggression staple. Ask about combos and how his stats stack up.' },
];

export default function AiDiscoveryPage() {
  return (
    <div className="lc-container lc-section">
      <header style={{ marginBottom: 24 }}>
        <p
          style={{
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--accent-2, #6A43BE)',
            marginBottom: 4,
          }}
        >
          Tools · Disney Lorcana
        </p>
        <h1 style={{ fontSize: 32, margin: 0 }}>Lorcana AI</h1>
        <p style={{ color: 'var(--text-muted)', maxWidth: 720, marginTop: 8 }}>
          Ask questions about any Lorcana card. The AI is grounded in the same
          card database that powers the rest of the site — printings, rarities,
          effects, live pricing, character families. It answers about the exact
          card whose page you&rsquo;re on, so context is always precise.
        </p>
      </header>

      <section
        style={{
          padding: 20,
          border: '1px solid var(--border)',
          borderRadius: 14,
          background: 'var(--surface)',
          marginBottom: 24,
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>How it works</h2>
        <ol style={{ margin: 0, paddingLeft: 22, lineHeight: 1.7 }}>
          <li>Open any card page (via search, the Card Finder, or a set page).</li>
          <li>Scroll to the &ldquo;Ask about {`{card name}`}&rdquo; panel.</li>
          <li>Type your question. The AI answers using the card&rsquo;s
              real ink, cost, effect, rarity, prices and sibling versions.</li>
        </ol>
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
          The AI never invents prices or prints. If a fact isn&rsquo;t in the
          catalogue, it says so.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>Try it on a featured card</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {FEATURED.map((f) => (
            <Link
              key={f.slug}
              href={`/card/${f.slug}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: 16,
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                textDecoration: 'none',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{f.name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{f.blurb}</div>
              <div style={{ marginTop: 10, fontSize: 13, color: 'var(--accent-2)' }}>
                Open card page →
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section
        style={{
          marginTop: 24,
          padding: 20,
          border: '1px solid var(--border)',
          borderRadius: 14,
          background: 'var(--surface)',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Or search for a card</h2>
        <p style={{ margin: 0, marginBottom: 10 }}>
          Head to the <Link href="/card-finder">Card Finder</Link> or use the
          search bar at the top of the page. Open any card, then scroll to the
          AI panel.
        </p>
      </section>
    </div>
  );
}
