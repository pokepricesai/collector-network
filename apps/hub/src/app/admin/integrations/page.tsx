import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  Panel, SectionHeader, StatusBadge, Table,
} from '@/components/admin/admin-ui';

export const dynamic = 'force-dynamic';

interface IntegrationRow {
  id: string;
  provider: string;
  site_id: string | null;
  status: 'not_connected' | 'connected' | 'needs_configuration' | 'error' | 'disabled';
  credential_env: string | null;
  last_success_at: string | null;
  error_summary: string | null;
}

const PROVIDER_LABEL: Record<string, string> = {
  gsc: 'Google Search Console',
  ga4: 'Google Analytics',
  bigquery: 'BigQuery (PokePrices export)',
  bing_wmt: 'Bing Webmaster',
  indexnow: 'IndexNow',
  internal_db: 'Site database',
  ebay_epn: 'eBay Partner Network',
  x: 'X',
  vercel: 'Vercel',
};

export default async function IntegrationsPage() {
  const { admin, sb } = await requireAdmin('/admin/integrations');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  const { data } = await sb
    .from('network_integrations')
    .select('id, provider, site_id, status, credential_env, last_success_at, error_summary')
    .order('provider');

  const rows: IntegrationRow[] = (data as IntegrationRow[]) ?? [];

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/integrations">
      <SectionHeader
        eyebrow="Platform"
        title="Integrations"
        description="Live registry of planned external connections. Secrets never land in this table; the credential_env column names the environment variable the server will read."
        actions={
          <a href="/admin/integrations/google-diagnostic" className="admin-signout-btn">
            Run Google credential diagnostic
          </a>
        }
      />
      <Panel>
        <Table
          columns={[
            { key: 'provider', header: 'Provider',  render: (r) => <span style={{ fontWeight: 600 }}>{PROVIDER_LABEL[r.provider] ?? r.provider}</span> },
            { key: 'site',     header: 'Site',      render: (r) => <span className="col-dim">{r.site_id ? (sitesById.get(r.site_id)?.name ?? '—') : 'Network'}</span> },
            { key: 'status',   header: 'Status',    render: (r) => <StatusBadge state={r.status} /> },
            { key: 'cred',     header: 'Credential', render: (r) => <span className="col-dim">{r.credential_env ?? '—'}</span> },
            { key: 'last',     header: 'Last success', render: (r) => <span className="col-dim">{r.last_success_at ? new Date(r.last_success_at).toISOString().slice(0, 10) : '—'}</span> },
          ]}
          rows={rows}
        />
      </Panel>
    </AdminShell>
  );
}
