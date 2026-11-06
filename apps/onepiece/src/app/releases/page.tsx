import type { Metadata } from 'next';
import Link from 'next/link';
import { canonicalFor } from '@/lib/seo';

// CN-06.06 · One Piece release calendar.
//
// Pulls from the shared Hub public feed (/api/public/releases/onepiece)
// which is CDN-cached 24h and projects only publicly-safe columns.
// This page does NOT query Supabase directly — single shared feed
// amortises load across all five network sites.
//
// Honour release_date_precision — never render a day when only a
// month is known. "TBC" is a legitimate first-class state.
//
// Index posture:
//   * INDEX when at least one upcoming release is tracked.
//   * NOINDEX when the feed returns empty, to avoid shipping a
//     thin "no content yet" page into Google's index while the
//     operator is still curating.

export const revalidate = 900; // 15-min ISR — matches the Hub feed's s-maxage
export const dynamic = 'force-static';

interface PublicReleaseRow {
  id: string;
  tcg: 'onepiece';
  site_slug: 'onepiece';
  set_name: string;
  set_name_translated: string | null;
  translation_official: boolean;
  set_code: string | null;
  product_type: 'expansion' | 'booster' | 'starter_deck' | 'structure_deck'
    | 'special_collection' | 'premium' | 'promo' | 'other';
  language: 'en' | 'ja' | 'other';
  region: string | null;
  release_date: string | null;
  release_date_precision: 'day' | 'month' | 'quarter' | 'tbc';
  prerelease_date: string | null;
  confirmation_status: 'confirmed' | 'announced_tbc' | 'postponed' | 'released';
  source_url: string | null;
  site_set_url: string | null;
  previous_release_date: string | null;
  date_changed_at: string | null;
  updated_at: string;
}

interface FeedResponse {
  ok: boolean;
  tcg: string;
  generated_at: string;
  counts: { upcoming: number; recently_released: number };
  upcoming: PublicReleaseRow[];
  recently_released: PublicReleaseRow[];
}

function getHubUrl(): string {
  const raw = process.env['NEXT_PUBLIC_HUB_URL'] ?? 'https://hub.collectornetwork.io';
  return raw.replace(/\/$/, '');
}

async function fetchReleases(): Promise<FeedResponse | null> {
  const hub = getHubUrl();
  try {
    const res = await fetch(`${hub}/api/public/releases/onepiece`, {
      // Next.js data cache aligns with our page revalidate. The
      // Hub endpoint also emits s-maxage=86400 for Vercel's CDN.
      next: { revalidate: 900, tags: ['releases:onepiece'] },
    });
    if (!res.ok) {
      console.error(`[releases] hub feed HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as FeedResponse;
  } catch (err) {
    // Fail soft: an unreachable Hub feed renders an empty-state
    // page, not a 500. Preserves SEO during a Hub outage.
    console.error('[releases] hub feed fetch failed:', (err as Error).message);
    return null;
  }
}

function formatReleaseLabel(r: Pick<PublicReleaseRow, 'release_date' | 'release_date_precision'>): string {
  if (!r.release_date || r.release_date_precision === 'tbc') return 'TBC';
  if (r.release_date_precision === 'quarter') {
    const m = r.release_date.match(/^(\d{4})-(\d{2})/);
    if (!m) return 'TBC';
    const quarter = Math.floor((Number(m[2]) - 1) / 3) + 1;
    return `Q${quarter} ${m[1]}`;
  }
  const d = new Date(r.release_date + 'T00:00:00Z');
  if (r.release_date_precision === 'month') {
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function daysUntil(r: Pick<PublicReleaseRow, 'release_date' | 'release_date_precision'>): number | null {
  // Day-countdown is only honest at day precision. A "in N days"
  // chip on a month or quarter row would fabricate specificity.
  if (!r.release_date) return null;
  if (r.release_date_precision !== 'day') return null;
  const today = new Date();
  const todayMs = Date.parse(today.toISOString().slice(0, 10) + 'T00:00:00Z');
  const rMs = Date.parse(r.release_date + 'T00:00:00Z');
  if (!Number.isFinite(rMs) || !Number.isFinite(todayMs)) return null;
  return Math.round((rMs - todayMs) / 86_400_000);
}

const PRODUCT_LABEL: Record<PublicReleaseRow['product_type'], string> = {
  expansion: 'Booster expansion',
  booster: 'Booster',
  starter_deck: 'Starter deck',
  structure_deck: 'Structure deck',
  special_collection: 'Special collection',
  premium: 'Premium set',
  promo: 'Promo',
  other: 'Other',
};

const LANGUAGE_LABEL: Record<PublicReleaseRow['language'], string> = {
  en: 'English',
  ja: 'Japanese',
  other: 'Other',
};

export async function generateMetadata(): Promise<Metadata> {
  const feed = await fetchReleases();
  const hasContent = (feed?.counts.upcoming ?? 0) + (feed?.counts.recently_released ?? 0) > 0;
  const canonical = canonicalFor('/releases');
  return {
    title: 'One Piece release calendar — upcoming sets, boosters and decks',
    description:
      'Upcoming One Piece Card Game releases. Confirmed dates and announced-TBC entries, with publisher source links. Covers English and Japanese releases.',
    alternates: { canonical },
    robots: hasContent ? { index: true, follow: true } : { index: false, follow: true },
  };
}

export default async function ReleasesPage() {
  const feed = await fetchReleases();
  const upcoming = feed?.upcoming ?? [];
  const recent = feed?.recently_released ?? [];
  const hasAny = upcoming.length > 0 || recent.length > 0;
  const feedUnavailable = feed === null;

  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="op-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              Releases · One Piece Card Game
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 'clamp(24px, 4.5vw, 30px)' }}>
              Release calendar
            </h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.55, maxWidth: 640 }}>
              Upcoming One Piece Card Game sets, boosters and decks across English and Japanese releases.
              Dates are taken from Bandai&apos;s official announcements. Approximate and TBC dates are labelled.
            </p>
          </div>
        </header>

        {feedUnavailable && (
          <Panel role="status" tone="warning">
            <strong>Release feed temporarily unavailable.</strong> The upcoming calendar will return shortly.
          </Panel>
        )}

        {!feedUnavailable && !hasAny && (
          <Panel role="status">
            <strong>No upcoming releases tracked yet.</strong>{' '}
            We publish release dates once Bandai has confirmed them. Check back shortly, or follow{' '}
            <a href="https://en.onepiece-cardgame.com/products/" target="_blank" rel="noopener nofollow">
              the official product page
            </a>{' '}
            in the meantime.
          </Panel>
        )}

        {upcoming.length > 0 && (
          <Section title={`Upcoming (${upcoming.length})`} description="Next 180 days. Postponed entries kept visible so the delay is honest.">
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
              {upcoming.map((r) => <ReleaseCard key={r.id} r={r} />)}
            </ol>
          </Section>
        )}

        {recent.length > 0 && (
          <Section title={`Recently released (${recent.length})`} description="Shipped in the last 30 days.">
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
              {recent.map((r) => <ReleaseCard key={r.id} r={r} />)}
            </ol>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  title, description, children,
}: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        {description && (
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function Panel({
  children, role, tone = 'info',
}: { children: React.ReactNode; role?: string; tone?: 'info' | 'warning' }) {
  return (
    <div
      role={role}
      style={{
        background: 'var(--surface)',
        border: `1px solid ${tone === 'warning' ? 'var(--gold-600, #c9a227)' : 'var(--border)'}`,
        borderRadius: 14,
        padding: 20,
        fontSize: 14,
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}

function ReleaseCard({ r }: { r: PublicReleaseRow }) {
  const d = daysUntil(r);
  const label = formatReleaseLabel(r);
  const postponed = r.confirmation_status === 'postponed';
  const announcedOnly = r.confirmation_status === 'announced_tbc' || r.release_date_precision === 'tbc';
  const dateChangedRecent = r.date_changed_at
    ? Date.now() - Date.parse(r.date_changed_at) < 14 * 86_400_000
    : false;

  const cardStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    gap: 14,
    alignItems: 'center',
    padding: '14px 16px',
    borderRadius: 12,
    textDecoration: 'none',
    color: 'var(--text)',
    background: 'var(--bg-light)',
    border: '1px solid var(--border)',
  };

  const dateBlock = (
    <div style={{ textAlign: 'center', minWidth: 72 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {r.release_date_precision === 'tbc' ? 'Status'
          : r.release_date_precision === 'quarter' ? 'Quarter'
          : r.release_date_precision === 'month' ? 'Month'
          : 'Date'}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{label}</div>
      {d != null && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {d === 0 ? 'today' : d > 0 ? `in ${d}d` : `${Math.abs(d)}d ago`}
        </div>
      )}
    </div>
  );

  const infoBlock = (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>
        {r.set_name}
        {r.set_code && (
          <span className="label-mono" style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
            {r.set_code.toUpperCase()}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <span>{PRODUCT_LABEL[r.product_type] ?? r.product_type}</span>
        <span>·</span>
        <span>{LANGUAGE_LABEL[r.language]}</span>
        {r.region && (<><span>·</span><span>{r.region}</span></>)}
        {postponed && (
          <span style={{ color: 'var(--gold-600, #c9a227)', fontWeight: 600 }}>· Postponed</span>
        )}
        {announcedOnly && !postponed && (
          <span style={{ color: 'var(--text-muted)' }}>· Date not yet final</span>
        )}
        {dateChangedRecent && r.previous_release_date && (
          <span style={{ color: 'var(--gold-600, #c9a227)' }}>
            · Date updated (was {new Date(r.previous_release_date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })})
          </span>
        )}
      </div>
    </div>
  );

  const actionBlock = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 90 }}>
      {r.site_set_url && (
        <span style={{ fontSize: 11, color: 'var(--gold-600)', fontWeight: 600 }}>
          View set →
        </span>
      )}
      {r.source_url && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Source: {new URL(r.source_url).hostname.replace(/^www\./, '')}
        </span>
      )}
    </div>
  );

  // When we have a site_set_url the whole card is a Link to the
  // existing set page (the Phase-4 requirement: "Link a release
  // to an existing catalogue set"). When we don't, the card is a
  // non-interactive div and the Source URL renders separately
  // below as an external link.

  if (r.site_set_url) {
    return (
      <li>
        <Link href={r.site_set_url} className="card-hover" style={cardStyle}>
          {dateBlock}
          {infoBlock}
          {actionBlock}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <div style={cardStyle}>
        {dateBlock}
        {infoBlock}
        {actionBlock}
      </div>
      {r.source_url && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, paddingLeft: 16 }}>
          <a href={r.source_url} target="_blank" rel="noopener nofollow" style={{ color: 'var(--text-muted)' }}>
            Official source ↗
          </a>
        </div>
      )}
    </li>
  );
}
