import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isLcInk, LC_INK_LABEL, LC_INK_DESCRIPTOR, type LcInk } from '@/lib/lorcana/ink';
import { getPricedTiles } from '@/server/discovery';
import CardBoard from '@/components/home/CardBoard';
import { canonicalFor } from '@/lib/seo';
import Faq from '@/components/Faq';
import { inkFaq } from '@/lib/faq-content';
import { getLorcanaCurrency } from '@/lib/currency-server';

export const revalidate = 900;
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isLcInk(slug)) return { title: 'Ink not found' };
  const label = LC_INK_LABEL[slug];
  return {
    title: `${label} Lorcana cards — top-value, Enchanted and every printing`,
    description: `Every ${label} Disney Lorcana card ordered by cheapest current USD retail. Includes ${label} Enchanted, Iconic, Epic, Legendary and base rarities.`,
    alternates: { canonical: canonicalFor(`/inks/${slug}`) },
  };
}

const INK_STORIES: Record<LcInk, string> = {
  amber: 'Amber is the ink of healing, community and support — the axis Herald of Harmony, Belle and cleric-leaning strategies live on. Amber decks stall out board pressure with Song plays and Bodyguard characters.',
  amethyst: 'Amethyst is Lorcana\'s mystical ink — sorcerers, ethereal spellwork and lore engines. Elsa, Merlin and the Enchanted-heavy Snow Queen / Spirit of Winter treatments are Amethyst signatures.',
  emerald: 'Emerald is the trickster ink — deception, card manipulation and tempo swings. Peter Pan, Genie and Robin Hood characters drive Emerald\'s value both at the table and on the collector market.',
  ruby: 'Ruby is passion, aggression and glory. Mickey Mouse — Brave Little Tailor anchors Ruby\'s marquee tier, backed by Simba, Hercules and other combat-forward heroes.',
  sapphire: 'Sapphire is wisdom, invention and artifice — the item-driven, engine-heavy ink. Merlin, Minnie Mouse and Ariel\'s Grotto Location pieces define Sapphire\'s tempo.',
  steel: 'Steel is resilience, courage and raw force — the ink of Beast, Simba and the big-body defenders. Steel Legendaries anchor most every Set 1–8 chase list.',
};

export default async function InkDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isLcInk(slug)) notFound();
  const label = LC_INK_LABEL[slug];
  const currency = await getLorcanaCurrency();

  const [mostValuable, enchanted, legendary] = await Promise.all([
    getPricedTiles({ limit: 12, ink: slug, cardCandidates: 500, currency }),
    getPricedTiles({ limit: 6, ink: slug, rarity: 'Enchanted', cardCandidates: 260, currency }),
    getPricedTiles({ limit: 6, ink: slug, rarity: 'Legendary', cardCandidates: 200, currency }),
  ]);

  return (
    <div className="lc-container lc-section">
      <nav
        aria-label="Breadcrumb"
        style={{ marginBottom: 14, fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <Link href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Home</Link>
        <span aria-hidden>›</span>
        <Link href="/inks" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Inks</Link>
        <span aria-hidden>›</span>
        <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{label}</span>
      </nav>

      <header className="lc-page-hero" style={{ marginBottom: 24, position: 'relative' }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(60% 80% at 100% 50%, var(--ink-${slug}) 0%, transparent 50%)`,
          opacity: 0.14,
          zIndex: 0,
          pointerEvents: 'none',
        }} aria-hidden />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <span aria-hidden style={{
              width: 20, height: 20, borderRadius: '50%',
              background: `var(--ink-${slug})`,
              boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.10)',
            }} />
            <div className="label-mono">Ink · {LC_INK_DESCRIPTOR[slug]}</div>
          </div>
          <h1 style={{ margin: '4px 0 8px' }}>{label} cards</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', maxWidth: 640, fontSize: 15, lineHeight: 1.6 }}>
            {INK_STORIES[slug]}
          </p>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href={`/card-finder?ink=${slug}`} className="btn btn-primary btn-sm">Filter by {label}</Link>
            <Link href={`/card-finder?ink=${slug}&rarity=Enchanted`} className="btn btn-gold btn-sm">{label} Enchanted</Link>
          </div>
        </div>
      </header>

      <section style={{ marginBottom: 32 }}>
        <header style={{ marginBottom: 12 }}>
          <div className="label-mono">Most valuable</div>
          <h2 style={{ margin: '4px 0 0' }}>Top {label} cards</h2>
        </header>
        <CardBoard tiles={mostValuable} columns={6} compact emptyLabel={`No priced ${label} cards yet.`} />
      </section>

      {enchanted.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div className="lc-chase-panel">
            <header style={{ marginBottom: 12 }}>
              <div className="label-mono">Chase</div>
              <h2 style={{ margin: '4px 0 0' }}>{label} Enchanted</h2>
            </header>
            <CardBoard tiles={enchanted} columns={6} variant="dark" compact />
          </div>
        </section>
      )}

      {legendary.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <header style={{ marginBottom: 12 }}>
            <div className="label-mono">Tier</div>
            <h2 style={{ margin: '4px 0 0' }}>{label} Legendary</h2>
          </header>
          <CardBoard tiles={legendary} columns={6} compact />
        </section>
      )}

      <Faq title={`About ${label} Lorcana cards`} entries={inkFaq(label, slug)} />
    </div>
  );
}
