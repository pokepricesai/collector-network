import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, MetricCard, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatInt, formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

interface QueueRow {
  id: string;
  recipient_email: string;
  site_code: string;
  template_key: string;
  category: string;
  status: string;
  attempts: number;
  send_after: string | null;
  sent_at: string | null;
  last_error: string | null;
  skipped_reason: string | null;
  created_at: string;
}

interface BreakdownRow {
  id: string;
  label: string;
  sent: number;
  pending: number;
  failed: number;
  suppressed: number;
}

function stateFor(status: string): 'ok' | 'pending' | 'failed' | 'info' | 'suppressed' {
  if (status === 'sent') return 'ok';
  if (status === 'pending' || status === 'sending') return 'pending';
  if (status === 'failed') return 'failed';
  if (status === 'suppressed' || status === 'skipped') return 'suppressed';
  return 'info';
}

export default async function EmailsDashboard() {
  const { admin, sb } = await requireAdmin('/admin/emails');
  const sites = await listNetworkSites(sb);

  const [
    { count: pendingCount },
    { count: sentCount },
    { count: failedCount },
    { count: suppressedCount },
    { data: recent },
    { data: byTemplate },
    { count: onboardingCount },
    { count: weeklyThisWeek },
  ] = await Promise.all([
    sb.from('collector_email_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('collector_email_queue').select('*', { count: 'exact', head: true }).eq('status', 'sent'),
    sb.from('collector_email_queue').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
    sb.from('collector_email_queue').select('*', { count: 'exact', head: true }).eq('status', 'suppressed'),
    sb.from('collector_email_queue')
      .select('id,recipient_email,site_code,template_key,category,status,attempts,send_after,sent_at,last_error,skipped_reason,created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    sb.from('collector_email_queue')
      .select('site_code,template_key,status')
      .limit(500),
    sb.from('collector_site_onboarding').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    sb.from('collector_email_queue').select('*', { count: 'exact', head: true })
      .eq('template_key', 'weekly_digest')
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
  ]);

  const rows = (recent ?? []) as QueueRow[];
  const breakdown = new Map<string, Omit<BreakdownRow, 'id' | 'label'>>();
  for (const r of (byTemplate ?? []) as { site_code: string; template_key: string; status: string }[]) {
    const key = `${r.site_code} · ${r.template_key}`;
    if (!breakdown.has(key)) breakdown.set(key, { sent: 0, failed: 0, pending: 0, suppressed: 0 });
    const b = breakdown.get(key)!;
    if (r.status === 'sent') b.sent++;
    else if (r.status === 'failed') b.failed++;
    else if (r.status === 'pending') b.pending++;
    else if (r.status === 'suppressed') b.suppressed++;
  }
  const breakdownRows: BreakdownRow[] = Array.from(breakdown.entries()).map(([label, b], i) => ({
    id: String(i),
    label,
    sent: b.sent,
    pending: b.pending,
    failed: b.failed,
    suppressed: b.suppressed,
  }));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/emails">
      <SectionHeader
        eyebrow="Email"
        title="Network email"
        description="CN-03 cross-site queue (MTG · YGO · One Piece · Lorcana). PokePrices runs its own stack independently."
      />

      <div className="metric-grid">
        <MetricCard label="Pending" value={formatInt(pendingCount ?? 0)} />
        <MetricCard label="Sent" value={formatInt(sentCount ?? 0)} />
        <MetricCard label="Failed" value={formatInt(failedCount ?? 0)} state={(failedCount ?? 0) > 0 ? 'no-data' : 'muted'} />
        <MetricCard label="Suppressed" value={formatInt(suppressedCount ?? 0)} />
        <MetricCard label="Active onboardings" value={formatInt(onboardingCount ?? 0)} helper="users in a 7-day sequence" />
        <MetricCard label="Weekly digests (7d)" value={formatInt(weeklyThisWeek ?? 0)} />
      </div>

      <Panel title="By site + template" eyebrow="Rolling totals">
        {breakdownRows.length === 0 ? (
          <EmptyState title="No queue activity yet" description="The scheduler enqueues on first authenticated visit. Enable CN03_SCHEDULE_ONBOARDING_ENABLED and set CN03_ONBOARDING_ELIGIBLE_AFTER to begin." tone="muted" />
        ) : (
          <Table<BreakdownRow>
            columns={[
              { key: 'label', header: 'Site · template', render: (r) => r.label },
              { key: 'sent', header: 'Sent', render: (r) => formatInt(r.sent) },
              { key: 'pending', header: 'Pending', render: (r) => formatInt(r.pending) },
              { key: 'failed', header: 'Failed', render: (r) => formatInt(r.failed) },
              { key: 'suppressed', header: 'Suppressed', render: (r) => formatInt(r.suppressed) },
            ]}
            rows={breakdownRows}
          />
        )}
      </Panel>

      <Panel title="Recent queue rows" eyebrow="Last 50 enqueued">
        {rows.length === 0 ? (
          <EmptyState title="Queue is empty" description="No welcomes, onboarding steps or digests have been enqueued yet." tone="muted" />
        ) : (
          <Table<QueueRow>
            columns={[
              { key: 'created', header: 'Enqueued', render: (r) => formatRelative(r.created_at) },
              { key: 'recipient', header: 'Recipient', render: (r) => <span style={{ fontSize: 12 }}>{r.recipient_email}</span> },
              { key: 'site', header: 'Site', render: (r) => r.site_code },
              { key: 'template', header: 'Template', render: (r) => r.template_key },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge state={stateFor(r.status)} label={r.status} /> },
              { key: 'attempts', header: 'Att.', render: (r) => r.attempts },
              { key: 'sent_at', header: 'Sent', render: (r) => r.sent_at ? formatRelative(r.sent_at) : <span className="col-dim">—</span> },
              { key: 'note', header: 'Note', render: (r) => <span className="col-dim" style={{ fontSize: 11 }}>{r.last_error ?? r.skipped_reason ?? '—'}</span> },
            ]}
            rows={rows}
          />
        )}
      </Panel>

      <Panel title="Operational notes" eyebrow="Safety switches">
        <ul style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--admin-text)', paddingLeft: 20, margin: 0 }}>
          <li>Live sends require <code>CN03_SEND_PENDING_ENABLED=true</code> (safety off by default).</li>
          <li>Onboarding scheduling requires <code>CN03_SCHEDULE_ONBOARDING_ENABLED=true</code> and <code>CN03_ONBOARDING_ELIGIBLE_AFTER=&lt;ISO date&gt;</code>.</li>
          <li>Weekly digests require <code>CN03_WEEKLY_DIGEST_ENABLED=true</code>.</li>
          <li><code>CN03_EMAIL_TEST_REDIRECT=you@example.com</code> reroutes all sends to a single address for staging verification.</li>
          <li>PokePrices operates independently; the hub does NOT enqueue for <code>site_code=&#39;pokemon&#39;</code>.</li>
        </ul>
        <p style={{ fontSize: 13, color: 'var(--admin-text-muted)', marginTop: 12 }}>
          <Link href="/admin/health">View operational health →</Link>
        </p>
      </Panel>
    </AdminShell>
  );
}
