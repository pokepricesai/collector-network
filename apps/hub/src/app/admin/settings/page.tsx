import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  EmptyState, Panel, SectionHeader, StatusBadge, Table,
} from '@/components/admin/admin-ui';

export const dynamic = 'force-dynamic';

interface AdminUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export default async function SettingsPage() {
  const { admin, sb } = await requireAdmin('/admin/settings');
  const sites = await listNetworkSites(sb);

  const [{ data: userRows }, { data: settingsRows }] = await Promise.all([
    sb.from('network_admin_users')
      .select('id, email, display_name, role, is_active, created_at, last_login_at')
      .order('created_at'),
    sb.from('network_settings')
      .select('id, key, value, site_id, description, updated_at')
      .order('key'),
  ]);

  const admins = (userRows as AdminUserRow[]) ?? [];
  const settings = (settingsRows as Array<{ id: string; key: string; value: unknown; site_id: string | null; description: string | null; updated_at: string }>) ?? [];

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/settings">
      <SectionHeader
        eyebrow="Platform"
        title="Settings"
        description="Network configuration, site registry and admin users. Future network-wide knobs land here."
      />

      <Panel title="Admin users" eyebrow="Access">
        <Table
          columns={[
            { key: 'email',  header: 'Email',  render: (u) => <span style={{ fontWeight: 600 }}>{u.email}</span> },
            { key: 'name',   header: 'Name',   render: (u) => <span className="col-dim">{u.display_name ?? '—'}</span> },
            { key: 'role',   header: 'Role',   render: (u) => <StatusBadge state={u.role} /> },
            { key: 'active', header: 'Status', render: (u) => <StatusBadge state={u.is_active ? 'active' : 'disabled'} /> },
            { key: 'last',   header: 'Last login', render: (u) => <span className="col-dim">{u.last_login_at ? new Date(u.last_login_at).toISOString().slice(0, 10) : '—'}</span> },
          ]}
          rows={admins}
          empty={<EmptyState title="No admin users yet" description="See docs/network/os-architecture.md for the bootstrap-first-admin flow." tone="muted" />}
        />
      </Panel>

      <Panel title="Sites" eyebrow="Registry">
        <Table
          columns={[
            { key: 'name',   header: 'Name',       render: (s) => <span style={{ fontWeight: 600 }}>{s.name}</span> },
            { key: 'slug',   header: 'Slug',       render: (s) => <span className="col-dim">{s.slug}</span> },
            { key: 'canon',  header: 'Canonical',  render: (s) => <a href={s.canonicalUrl} target="_blank" rel="noopener noreferrer" className="col-dim">{s.canonicalUrl}</a> },
            { key: 'status', header: 'Status',     render: (s) => <StatusBadge state={s.status} /> },
          ]}
          rows={sites.map((s) => ({ ...s, id: s.id }))}
        />
      </Panel>

      <Panel title="Network settings" eyebrow="Config">
        <Table
          columns={[
            { key: 'key',    header: 'Key',    render: (r) => <span style={{ fontWeight: 600 }}>{r.key}</span> },
            { key: 'scope',  header: 'Scope',  render: (r) => <span className="col-dim">{r.site_id ? 'Site' : 'Network'}</span> },
            { key: 'value',  header: 'Value',  render: (r) => <code style={{ fontSize: 11 }}>{JSON.stringify(r.value)}</code> },
            { key: 'desc',   header: 'Description', render: (r) => <span className="col-dim">{r.description ?? '—'}</span> },
          ]}
          rows={settings}
          empty={<EmptyState title="No settings yet" description="Keys populate as later features need per-network configuration." tone="muted" />}
        />
      </Panel>
    </AdminShell>
  );
}
