import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatRelative } from '@/lib/format';
import { composeNewsletterAction } from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

interface Row { id: string; title: string; status: string; for_date: string | null; send_target: string; created_at: string; sent_at: string | null }

export default async function NewsletterPage() {
  const { admin, sb } = await requireAdmin('/admin/newsletter');
  const sites = await listNetworkSites(sb);
  const { data } = await sb.from('network_newsletters')
    .select('id, title, status, for_date, send_target, created_at, sent_at')
    .order('created_at', { ascending: false }).limit(50);
  const rows = (data ?? []) as Row[];

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/newsletter">
      <SectionHeader
        eyebrow="Newsletter"
        title="Newsletter"
        description="Draft-only in Phase 4 — composes a weekly newsletter from published articles + PokePrices movers + daily brief. No autosend. Review a draft before setting the send_target to any provider."
        actions={
          <form action={composeNewsletterAction}>
            <button className="status-badge status-opportunity" style={{ cursor: 'pointer', border: 'none', fontSize: 11 }} type="submit">Compose weekly draft</button>
          </form>
        }
      />
      {rows.length === 0 ? (
        <Panel title="No newsletters yet" eyebrow="Drafts"><EmptyState title="Nothing composed." description="Click 'Compose weekly draft' to pull from this week's published articles + 30d movers + daily brief into a draft." tone="muted" /></Panel>
      ) : (
        <Panel title={`${rows.length} newsletter${rows.length === 1 ? '' : 's'}`} eyebrow="Drafts">
          <Table<Row>
            columns={[
              { key: 't', header: 'Title', render: (r) => <Link href={`/admin/newsletter/${r.id}`} style={{ fontWeight: 600 }}>{r.title}</Link> },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge state={r.status === 'sent' ? 'success' : r.status === 'approved' ? 'approved' : 'info'} label={r.status} /> },
              { key: 'target', header: 'Target', render: (r) => <code style={{ fontSize: 11 }}>{r.send_target}</code> },
              { key: 'date', header: 'For', render: (r) => r.for_date ?? <span className="col-dim">—</span> },
              { key: 'created', header: 'Created', render: (r) => formatRelative(r.created_at) },
            ]}
            rows={rows}
          />
        </Panel>
      )}
    </AdminShell>
  );
}
