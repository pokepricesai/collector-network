import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Notice } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listReleases } from '@/server/releases/queries';
import {
  CONFIRMATION_LABEL, CONFIRMATION_TONE, PRODUCT_TYPE_LABEL, TCG_LABEL,
  daysUntilRelease, formatReleaseDate,
  type ConfirmationStatus, type Tcg,
} from '@/server/releases/types';
import { createReleaseAction } from './actions';

// Release Tracker · list + create.
//
// Lives inside Intelligence (not a separate admin app). Shows the
// full calendar grouped into useful horizons; the operator can
// also create a release here or click through to edit any row.
//
// v1 is manual-curation only — see the "Source + verification"
// strip at the bottom of every row.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  searchParams?: Promise<{
    tcg?: string;
    language?: string;
    product_type?: string;
    status?: string;
    horizon?: string;
    created?: string;
    deleted?: string;
    create_error?: string;
  }>;
}

const TCG_OPTIONS: Array<{ v: Tcg; label: string }> = [
  { v: 'pokemon', label: 'Pokémon' },
  { v: 'mtg', label: 'MTG' },
  { v: 'ygo', label: 'Yu-Gi-Oh!' },
  { v: 'onepiece', label: 'One Piece' },
  { v: 'lorcana', label: 'Lorcana' },
];

const HORIZONS = [
  { v: 'next_30d', label: 'Next 30 days' },
  { v: 'next_90d', label: 'Next 90 days' },
  { v: 'next_12mo', label: 'Next 12 months' },
  { v: 'recent', label: 'Recently released' },
  { v: 'tbc', label: 'Announced · TBC' },
  { v: 'all', label: 'All' },
];

export default async function ReleasesPage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/intelligence/releases');
  const sites = await listNetworkSites(sb);
  const sp = (await searchParams) ?? {};
  const tcgFilter = (sp.tcg ?? '') as '' | Tcg;
  const horizon = sp.horizon ?? 'next_90d';

  // Horizon → date range.
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  let from: string | undefined;
  let to: string | undefined;
  let statuses: ConfirmationStatus[] | undefined;
  if (horizon === 'next_30d') { from = todayIso; to = isoPlusDays(today, 30); statuses = ['confirmed', 'announced_tbc', 'postponed'] }
  else if (horizon === 'next_90d') { from = todayIso; to = isoPlusDays(today, 90); statuses = ['confirmed', 'announced_tbc', 'postponed'] }
  else if (horizon === 'next_12mo') { from = todayIso; to = isoPlusDays(today, 365); statuses = ['confirmed', 'announced_tbc', 'postponed'] }
  else if (horizon === 'recent') { from = isoPlusDays(today, -30); to = todayIso; statuses = ['released', 'confirmed'] }
  else if (horizon === 'tbc') { statuses = ['announced_tbc', 'rumoured'] }

  const rows = await listReleases(sb, {
    tcg: (tcgFilter || undefined) as Tcg | undefined,
    from_date: from,
    to_date: to,
    statuses,
    limit: 500,
  });

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/intelligence/releases">
      <SectionHeader
        eyebrow="Collector Network · Intelligence · Releases"
        title="Upcoming TCG Releases"
        description={<>Cross-TCG release calendar. v1 is manual curation only — each row carries its source URL and a verified-at timestamp. The daily sweep job promotes rows to <code>released</code> when their date passes; it does <strong>not</strong> scrape publisher sites.</>}
        actions={<Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/intelligence">← Intelligence</Link>}
      />

      {sp.created && <Notice tone="success"><strong>Release created.</strong></Notice>}
      {sp.deleted && <Notice tone="info">Release deleted.</Notice>}
      {sp.create_error && <Notice tone="danger"><strong>Could not create release:</strong> {sp.create_error}</Notice>}

      {/* ─── Filters ─── */}
      <Panel title="Filters">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <FilterGroup label="TCG">
            <FilterLink href={buildHref(sp, { tcg: '', horizon })} active={!tcgFilter}>All</FilterLink>
            {TCG_OPTIONS.map((t) => (
              <FilterLink key={t.v} href={buildHref(sp, { tcg: t.v, horizon })} active={tcgFilter === t.v}>{t.label}</FilterLink>
            ))}
          </FilterGroup>
          <FilterGroup label="Horizon">
            {HORIZONS.map((h) => (
              <FilterLink key={h.v} href={buildHref(sp, { tcg: tcgFilter, horizon: h.v })} active={horizon === h.v}>{h.label}</FilterLink>
            ))}
          </FilterGroup>
        </div>
      </Panel>

      {/* ─── Release list ─── */}
      <Panel title={`${rows.length} release${rows.length === 1 ? '' : 's'}`} eyebrow={describeHorizon(horizon)}>
        {rows.length === 0 ? (
          <div style={{ padding: '12px 0', color: 'var(--admin-text-muted)', fontSize: 12.5 }}>
            Nothing in this view. {horizon !== 'all' && <>Try widening the horizon or <Link href="/admin/intelligence/releases?horizon=all">show all</Link>.</>}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((r) => (
              <li key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--admin-border)' }}>
                <ReleaseCard row={r} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ─── Create form ─── */}
      <Panel title="Add release" eyebrow="Manual curation">
        <form action={createReleaseAction} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, maxWidth: 1000 }}>
          <L label="TCG"><Select name="tcg" required options={TCG_OPTIONS.map((t) => ({ v: t.v, label: t.label }))} /></L>
          <L label="Site slug (default = TCG)"><Select name="site_slug" options={TCG_OPTIONS.map((t) => ({ v: t.v, label: t.label }))} /></L>
          <L label="Set name (published)" wide><input name="set_name" required maxLength={240} style={inputStyle} placeholder="e.g. Scarlet &amp; Violet — Mega Evolution" /></L>
          <L label="Set name (original)"><input name="set_name_original" maxLength={240} style={inputStyle} placeholder="日本語名" /></L>
          <L label="Set name (translated)"><input name="set_name_translated" maxLength={240} style={inputStyle} /></L>
          <L label="Set code"><input name="set_code" maxLength={48} style={inputStyle} placeholder="e.g. SV9" /></L>
          <L label="Product type">
            <Select name="product_type" options={[
              { v: 'expansion', label: 'Expansion' },
              { v: 'booster', label: 'Booster' },
              { v: 'starter_deck', label: 'Starter deck' },
              { v: 'structure_deck', label: 'Structure deck' },
              { v: 'special_collection', label: 'Special collection' },
              { v: 'premium', label: 'Premium set' },
              { v: 'promo', label: 'Promo' },
              { v: 'other', label: 'Other' },
            ]} />
          </L>
          <L label="Language"><Select name="language" options={[{v:'en',label:'English'},{v:'ja',label:'Japanese'},{v:'other',label:'Other'}]} /></L>
          <L label="Region"><input name="region" maxLength={32} style={inputStyle} placeholder="e.g. US / UK / Japan" /></L>
          <L label="Release date (YYYY-MM-DD or YYYY-MM)"><input name="release_date" maxLength={10} style={inputStyle} placeholder="2026-11-14" /></L>
          <L label="Precision">
            <Select name="release_date_precision" options={[{v:'day',label:'Exact day'},{v:'month',label:'Month only'},{v:'tbc',label:'TBC'}]} />
          </L>
          <L label="Prerelease date (optional)"><input name="prerelease_date" maxLength={10} style={inputStyle} placeholder="YYYY-MM-DD" /></L>
          <L label="Status">
            <Select name="confirmation_status" options={[
              { v: 'confirmed', label: 'Confirmed' },
              { v: 'announced_tbc', label: 'Announced · TBC' },
              { v: 'rumoured', label: 'Rumoured' },
              { v: 'postponed', label: 'Postponed' },
              { v: 'cancelled', label: 'Cancelled' },
            ]} />
          </L>
          <L label="Source URL" wide><input name="source_url" style={inputStyle} placeholder="https://..." /></L>
          <L label="Site set URL (if we already have a page)" wide><input name="site_set_url" style={inputStyle} placeholder="https://pokeprices.io/set/..." /></L>
          <L label="Source notes" wide><textarea name="source_notes" style={{ ...inputStyle, resize: 'vertical' }} rows={2} /></L>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">Add release</button>
            <span style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>
              This record is marked <code>verification_mode: manual</code>. Only populate when you have a published official source.
            </span>
          </div>
        </form>
      </Panel>
    </AdminShell>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px', border: '1px solid var(--admin-border)', borderRadius: 4, fontSize: 13, fontFamily: 'inherit', width: '100%',
};

function L({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

function Select({ name, options, required }: { name: string; options: Array<{ v: string; label: string }>; required?: boolean }) {
  return (
    <select name={name} required={required} style={inputStyle} defaultValue={options[0]?.v}>
      {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}

function ReleaseCard({ row }: { row: Awaited<ReturnType<typeof listReleases>>[number] }) {
  const d = daysUntilRelease(row);
  const dChip = d == null ? null : d < 0 ? `${Math.abs(d)}d ago` : d === 0 ? 'today' : `in ${d}d`;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'start' }}>
      <div style={{ fontSize: 11.5, color: 'var(--admin-text-muted)', minWidth: 110 }}>
        <strong style={{ color: 'var(--admin-text)', display: 'block' }}>{formatReleaseDate(row)}</strong>
        {dChip && <span>{dChip}</span>}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
          <strong style={{ fontSize: 13.5 }}>{row.set_name}</strong>
          <StatusBadge state="info" label={TCG_LABEL[row.tcg]} />
          <StatusBadge state="info" label={PRODUCT_TYPE_LABEL[row.product_type]} />
          <StatusBadge state="info" label={row.language === 'ja' ? 'Japanese' : row.language === 'en' ? 'English' : 'Other'} />
          <StatusBadge state={CONFIRMATION_TONE[row.confirmation_status]} label={CONFIRMATION_LABEL[row.confirmation_status]} />
          {row.region && <span style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>· {row.region}</span>}
          {row.set_code && <code style={{ fontSize: 11 }}>· {row.set_code}</code>}
        </div>
        {(row.set_name_original || row.set_name_translated) && (
          <div style={{ fontSize: 12, color: 'var(--admin-text-muted)', marginTop: 2 }}>
            {row.set_name_original && <>Original: <strong>{row.set_name_original}</strong>. </>}
            {row.set_name_translated && <>Translation: <strong>{row.set_name_translated}</strong>{row.translation_official ? '' : ' (unofficial)'}. </>}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--admin-text-muted)', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {row.prerelease_date && <span>Prerelease: <code>{row.prerelease_date}</code></span>}
          {row.source_url && <a href={row.source_url} rel="noopener noreferrer nofollow" target="_blank" style={{ color: 'var(--admin-text-muted)' }}>Source</a>}
          {row.site_set_url && <a href={row.site_set_url} rel="noopener noreferrer" target="_blank" style={{ color: 'var(--admin-text-muted)' }}>Site page</a>}
          <span>Verified: {row.source_verified_at ? new Date(row.source_verified_at).toISOString().slice(0,10) : '—'}</span>
          <span>Mode: <code>{row.verification_mode}</code></span>
          {row.previous_release_date && <span style={{ color: 'var(--warning, #e67e22)' }}>Date changed from <code>{row.previous_release_date}</code></span>}
        </div>
      </div>
      <Link href={`/admin/intelligence/releases/${row.id}`} className="ui-btn ui-btn--secondary ui-btn--sm" style={{ fontSize: 11 }}>Edit</Link>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="admin-eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{children}</div>
    </div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: 'inline-block', padding: '4px 10px', borderRadius: 999, fontSize: 12,
        border: `1px solid ${active ? 'var(--admin-accent, #4a90e2)' : 'var(--admin-border)'}`,
        background: active ? 'var(--admin-accent, #4a90e2)' : 'transparent',
        color: active ? '#fff' : 'var(--admin-text)',
        textDecoration: 'none',
      }}
    >{children}</Link>
  );
}

function buildHref(current: Record<string, string | undefined>, next: { tcg: string; horizon: string }): string {
  const sp = new URLSearchParams();
  if (next.tcg) sp.set('tcg', next.tcg);
  if (next.horizon && next.horizon !== 'next_90d') sp.set('horizon', next.horizon);
  void current;
  const qs = sp.toString();
  return qs ? `/admin/intelligence/releases?${qs}` : `/admin/intelligence/releases`;
}

function describeHorizon(h: string): string {
  const found = HORIZONS.find((x) => x.v === h);
  return found?.label ?? h;
}

function isoPlusDays(d: Date, delta: number): string {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + delta);
  return copy.toISOString().slice(0, 10);
}
