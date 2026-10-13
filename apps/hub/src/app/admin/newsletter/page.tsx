import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { EmptyPanelNotice } from '@/components/admin/EmptyPanelNotice';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatRelative } from '@/lib/format';
import { composeNewsletterAction } from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

interface Row { id: string; title: string; status: string; for_date: string | null; send_target: string; created_at: string; sent_at: string | null }

// Translate raw send_target values into operator-facing copy.
function sendTargetLabel(target: string): { label: string; tone: 'info' | 'success' | 'disabled' } {
  if (target === 'manual_relay') return { label: 'Manual send', tone: 'info' };
  if (target === 'none' || target === '' || !target) return { label: 'No provider connected', tone: 'disabled' };
  // Fall through for any future provider slug (mailchimp, resend, buttondown…)
  return { label: target.replace(/_/g, ' '), tone: 'info' };
}

export default async function NewsletterPage() {
  const { admin, sb } = await requireAdmin('/admin/newsletter');
  const sites = await listNetworkSites(sb);
  const { data } = await sb.from('network_newsletters')
    .select('id, title, status, for_date, send_target, created_at, sent_at')
    .order('created_at', { ascending: false }).limit(50);
  const rows = (data ?? []) as Row[];

  const lastSent  = rows.find((r) => r.status === 'sent' && r.sent_at);
  const draft     = rows.find((r) => r.status === 'draft');
  const inReview  = rows.find((r) => r.status === 'review');
  const approved  = rows.find((r) => r.status === 'approved');
  const current   = inReview ?? approved ?? draft ?? null;
  const draftAgeDays = current?.created_at
    ? Math.round((Date.now() - new Date(current.created_at).getTime()) / 86400000)
    : null;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/newsletter">
      <SectionHeader
        eyebrow="Newsletter"
        title="Newsletter"
        description="Weekly draft from published articles + PokePrices movers + daily brief. No autosend. Human-reviewed before any provider push."
        actions={
          <form action={composeNewsletterAction}>
            <button className="ui-btn ui-btn--primary ui-btn--sm" type="submit">Compose weekly draft</button>
          </form>
        }
      />

      <Panel title="Cadence" eyebrow="Weekly">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13 }}>
          <div>
            <div className="admin-eyebrow" style={{ fontSize: 10 }}>Last sent</div>
            <div>{lastSent?.sent_at ? `${lastSent.title} · ${lastSent.sent_at.slice(0, 10)}` : <span className="col-dim">Never sent</span>}</div>
          </div>
          <div>
            <div className="admin-eyebrow" style={{ fontSize: 10 }}>Current draft</div>
            <div>{current ? (
              <Link href={`/admin/newsletter/${current.id}`} style={{ fontWeight: 600, textDecoration: 'none', color: 'inherit' }}>{current.title}</Link>
            ) : <span className="col-dim">None in flight</span>}</div>
            {draftAgeDays != null && <div className="col-dim" style={{ fontSize: 11 }}>Draft age: {draftAgeDays}d</div>}
          </div>
          <div>
            <div className="admin-eyebrow" style={{ fontSize: 10 }}>Provider</div>
            <div>
              {(() => {
                const t = current?.send_target ?? 'manual_relay';
                const { label, tone } = sendTargetLabel(t);
                return <StatusBadge state={tone} label={label} />;
              })()}
            </div>
          </div>
          <div>
            <div className="admin-eyebrow" style={{ fontSize: 10 }}>Next due</div>
            <div className="col-dim" style={{ fontSize: 12 }}>Compose when a weekly cadence slot opens</div>
          </div>
        </div>
      </Panel>

      {rows.length === 0 ? (
        <Panel title="Drafts">
          <EmptyPanelNotice>Nothing composed yet. Click <strong>Compose weekly draft</strong> at the top to pull this week&apos;s published articles + 30-day movers + daily brief into a draft.</EmptyPanelNotice>
        </Panel>
      ) : (
        <Panel title={`${rows.length} newsletter${rows.length === 1 ? '' : 's'}`} eyebrow="Drafts + history">
          <Table<Row>
            columns={[
              { key: 't', header: 'Title', render: (r) => <Link href={`/admin/newsletter/${r.id}`} style={{ fontWeight: 600 }}>{r.title}</Link> },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge state={r.status === 'sent' ? 'success' : r.status === 'approved' ? 'approved' : 'info'} label={r.status} /> },
              { key: 'target', header: 'Provider', render: (r) => {
                const { label, tone } = sendTargetLabel(r.send_target);
                return <StatusBadge state={tone} label={label} />;
              } },
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
