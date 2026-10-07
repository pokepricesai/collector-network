import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listSources, classifyHealth, type SourceHealth } from '@/server/autopilot/sources';
import { toggleSourceAction, refreshDiscoveryAction } from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

export default async function AutopilotSourcesPage() {
  const { admin, sb } = await requireAdmin('/admin/content/autopilot/sources');
  const sites = await listNetworkSites(sb);
  const sources = await listSources(sb, 'ygo');

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/content/autopilot/sources">
      <SectionHeader
        eyebrow="Content · Autopilot · Sources"
        title="External source registry"
        description={<>Admin-curated feeds the autopilot discovery pass may fetch. All sources ship <strong>disabled</strong> — enable one at a time, starting with tier-1 (official) sources.</>}
        actions={
          <span style={{ display: 'inline-flex', gap: 6 }}>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/content/autopilot">Settings</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/content/autopilot/preview">Preview →</Link>
            <form action={refreshDiscoveryAction} style={{ display: 'inline' }}>
              <input type="hidden" name="site_slug" value="ygo" />
              <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">Run discovery now</button>
            </form>
          </span>
        }
      />

      <Notice tone="info">
        The pipeline NEVER fetches a domain outside this registry. Each entry carries a trust tier (1 official / 2 secondary / 3 community).
        Tier-3 (community) signals are treated as DISCOVERY — never as authoritative evidence. Fetch is bounded (2 MB per feed, 12 s timeout, 1.2 s polite delay between sources).
      </Notice>

      <Panel title={`YGO sources (${sources.length})`} eyebrow="Admin may enable/disable each row">
        <Table
          columns={[
            { key: 't',  header: 'Tier', render: (r: SrcRow) => (
              <StatusBadge
                state={r.tier === 'official' ? 'success' : r.tier === 'secondary' ? 'info' : 'warning'}
                label={`T${r.trust_level} · ${r.tier}`}
              />
            ) },
            { key: 'n',  header: 'Name',     render: (r: SrcRow) => <strong>{r.name}</strong> },
            { key: 'h',  header: 'Health',   render: (r: SrcRow) => <HealthBadge h={r.health} /> },
            { key: 'm',  header: 'Method',   render: (r: SrcRow) => <code>{r.discovery_method}</code> },
            { key: 'f',  header: 'Feed / Listing', render: (r: SrcRow) => {
              const u = r.feed_url ?? r.listing_url;
              return u ? <code style={{ fontSize: 10 }}>{u.length > 36 ? u.slice(0, 33) + '…' : u}</code> : <span className="col-dim">—</span>;
            } },
            { key: 'r',  header: 'Last pass', render: (r: SrcRow) => r.last_discovered_at
              ? <code style={{ fontSize: 11 }}>{r.last_discovered_at.slice(0, 16).replace('T', ' ')}</code>
              : <span className="col-dim">never</span> },
            { key: 's',  header: 'Items / retained', render: (r: SrcRow) =>
              r.last_signal_count != null
                ? <code style={{ fontSize: 11 }}>{r.last_signal_count} / {r.last_signals_retained ?? 0}</code>
                : <span className="col-dim">—</span> },
            { key: 'err', header: 'Last error', render: (r: SrcRow) => r.last_error
              ? <code style={{ fontSize: 10, color: 'var(--danger)' }}>{r.last_error.length > 48 ? r.last_error.slice(0, 45) + '…' : r.last_error}</code>
              : <span className="col-dim">—</span> },
            { key: 'e',  header: 'Enabled',  render: (r: SrcRow) => (
              <form action={toggleSourceAction} style={{ display: 'inline' }}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="value" value={(!r.enabled).toString()} />
                <button type="submit" className="admin-btn" style={{ padding: '2px 10px', fontSize: 12 }}>
                  {r.enabled ? 'ON' : 'off'}
                </button>
              </form>
            ) },
          ]}
          rows={sources.map((s) => ({
            id: s.id,
            tier: s.tier,
            trust_level: s.trust_level,
            name: s.name,
            domain: s.domain,
            category: s.category,
            discovery_method: s.discovery_method,
            feed_url: s.feed_url,
            listing_url: s.listing_url,
            last_discovered_at: s.last_discovered_at,
            last_signal_count: s.last_signal_count,
            last_signals_retained: s.last_signals_retained,
            last_error: s.last_error,
            last_successful_fetch_at: s.last_successful_fetch_at,
            health: classifyHealth(s),
            enabled: s.enabled,
          }))}
          empty="No sources registered."
        />
      </Panel>

      <Panel title="Content usage policy summary" eyebrow="Reminder for the editorial pipeline">
        <ul style={{ fontSize: 13, lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
          <li>Never reproduce large passages or closely paraphrase a single source throughout an article.</li>
          <li>Short attributed quotations only, where genuinely useful.</li>
          <li>Prefer official primary sources; synthesise across secondary sources.</li>
          <li>Community tier is a discovery signal — not authoritative evidence.</li>
          <li>Images come from internal card/set catalogues only — never download editorial-site imagery.</li>
          <li>Every external source retains its URL + publisher + retrieval timestamp in the evidence pack for audit.</li>
        </ul>
      </Panel>
    </AdminShell>
  );
}

interface SrcRow {
  id: string;
  tier: 'official' | 'secondary' | 'community';
  trust_level: 1 | 2 | 3;
  name: string;
  domain: string;
  category: string | null;
  discovery_method: string;
  feed_url: string | null;
  listing_url: string | null;
  last_discovered_at: string | null;
  last_signal_count: number | null;
  last_signals_retained: number | null;
  last_error: string | null;
  last_successful_fetch_at: string | null;
  health: SourceHealth;
  enabled: boolean;
}

const HEALTH_META: Record<SourceHealth, { label: string; state: 'success' | 'info' | 'warning' | 'failed' | 'disabled' | 'archived' }> = {
  healthy:          { label: 'HEALTHY',           state: 'success' },
  no_recent_items:  { label: 'NO RECENT ITEMS',   state: 'info' },
  manual_only:      { label: 'MANUAL ONLY',       state: 'archived' },
  fetch_error:      { label: 'FETCH ERROR',       state: 'failed' },
  parse_error:      { label: 'PARSE ERROR',       state: 'failed' },
  filtered_to_zero: { label: 'FILTERED TO ZERO',  state: 'warning' },
  never_run:        { label: 'NEVER RUN',         state: 'disabled' },
};

function HealthBadge({ h }: { h: SourceHealth }) {
  const meta = HEALTH_META[h];
  return <StatusBadge state={meta.state} label={meta.label} />;
}
