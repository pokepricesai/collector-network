import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, Notice } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { getRelease } from '@/server/releases/queries';
import { updateReleaseAction, deleteReleaseAction } from '../actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ updated?: string; update_error?: string }>;
}

export default async function ReleaseEditPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { admin, sb } = await requireAdmin(`/admin/intelligence/releases/${id}`);
  const sites = await listNetworkSites(sb);
  const sp = (await searchParams) ?? {};
  const row = await getRelease(sb, id);
  if (!row) notFound();

  const inputStyle: React.CSSProperties = {
    padding: '6px 8px', border: '1px solid var(--admin-border)', borderRadius: 4, fontSize: 13, fontFamily: 'inherit', width: '100%',
  };

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname={`/admin/intelligence/releases/${id}`}>
      <SectionHeader
        eyebrow="Intelligence · Releases · Edit"
        title={row.set_name}
        description={<>{row.tcg} · {row.language === 'ja' ? 'Japanese' : row.language === 'en' ? 'English' : 'Other'}{row.region ? ` · ${row.region}` : ''}{row.set_code ? ` · ${row.set_code}` : ''}</>}
        actions={<Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/intelligence/releases">← Releases</Link>}
      />

      {sp.updated && <Notice tone="success"><strong>Updated.</strong></Notice>}
      {sp.update_error && <Notice tone="danger"><strong>Update failed:</strong> {sp.update_error}</Notice>}

      <Panel title="Edit release">
        <form action={updateReleaseAction} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, maxWidth: 1000 }}>
          <input type="hidden" name="id" value={row.id} />
          <L label="TCG">
            <select name="tcg" style={inputStyle} defaultValue={row.tcg}>
              <option value="pokemon">Pokémon</option>
              <option value="mtg">Magic: The Gathering</option>
              <option value="ygo">Yu-Gi-Oh!</option>
              <option value="onepiece">One Piece</option>
              <option value="lorcana">Lorcana</option>
            </select>
          </L>
          <L label="Site slug">
            <select name="site_slug" style={inputStyle} defaultValue={row.site_slug}>
              <option value="pokemon">pokemon</option><option value="mtg">mtg</option>
              <option value="ygo">ygo</option><option value="onepiece">onepiece</option>
              <option value="lorcana">lorcana</option>
            </select>
          </L>
          <L label="Set name" wide><input name="set_name" required maxLength={240} style={inputStyle} defaultValue={row.set_name} /></L>
          <L label="Set name (original)"><input name="set_name_original" maxLength={240} style={inputStyle} defaultValue={row.set_name_original ?? ''} /></L>
          <L label="Set name (translated)"><input name="set_name_translated" maxLength={240} style={inputStyle} defaultValue={row.set_name_translated ?? ''} /></L>
          <L label="Set code"><input name="set_code" maxLength={48} style={inputStyle} defaultValue={row.set_code ?? ''} /></L>
          <L label="Product type">
            <select name="product_type" style={inputStyle} defaultValue={row.product_type}>
              <option value="expansion">Expansion</option>
              <option value="booster">Booster</option>
              <option value="starter_deck">Starter deck</option>
              <option value="structure_deck">Structure deck</option>
              <option value="special_collection">Special collection</option>
              <option value="premium">Premium set</option>
              <option value="promo">Promo</option>
              <option value="other">Other</option>
            </select>
          </L>
          <L label="Language">
            <select name="language" style={inputStyle} defaultValue={row.language}>
              <option value="en">English</option><option value="ja">Japanese</option><option value="other">Other</option>
            </select>
          </L>
          <L label="Region"><input name="region" maxLength={32} style={inputStyle} defaultValue={row.region ?? ''} /></L>
          <L label="Release date (YYYY-MM-DD or YYYY-MM)"><input name="release_date" maxLength={10} style={inputStyle} defaultValue={row.release_date ?? ''} /></L>
          <L label="Precision">
            <select name="release_date_precision" style={inputStyle} defaultValue={row.release_date_precision}>
              <option value="day">Exact day</option><option value="month">Month only</option><option value="tbc">TBC</option>
            </select>
          </L>
          <L label="Prerelease date"><input name="prerelease_date" maxLength={10} style={inputStyle} defaultValue={row.prerelease_date ?? ''} /></L>
          <L label="Status">
            <select name="confirmation_status" style={inputStyle} defaultValue={row.confirmation_status}>
              <option value="confirmed">Confirmed</option>
              <option value="announced_tbc">Announced · TBC</option>
              <option value="rumoured">Rumoured</option>
              <option value="postponed">Postponed</option>
              <option value="released">Released</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </L>
          <L label="Source URL" wide><input name="source_url" style={inputStyle} defaultValue={row.source_url ?? ''} /></L>
          <L label="Site set URL" wide><input name="site_set_url" style={inputStyle} defaultValue={row.site_set_url ?? ''} /></L>
          <L label="Source notes" wide><textarea name="source_notes" style={{ ...inputStyle, resize: 'vertical' }} rows={2} defaultValue={row.source_notes ?? ''} /></L>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
            <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">Save changes</button>
          </div>
        </form>
      </Panel>

      <Panel title="Delete" eyebrow="Irreversible — change log is cascade-deleted">
        <form action={deleteReleaseAction}>
          <input type="hidden" name="id" value={row.id} />
          <button type="submit" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ color: 'var(--failed, #c0392b)' }}>Delete release</button>
        </form>
      </Panel>
    </AdminShell>
  );
}

function L({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}
