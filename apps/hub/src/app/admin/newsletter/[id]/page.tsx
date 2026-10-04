import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { formatRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Params { params: Promise<{ id: string }> }

export default async function NewsletterDetail({ params }: Params) {
  const { admin, sb } = await requireAdmin('/admin/newsletter');
  const sites = await listNetworkSites(sb);
  const { id } = await params;
  const [{ data: nl }, { data: sections }] = await Promise.all([
    sb.from('network_newsletters')
      .select('id, title, subject_line, preheader, for_date, status, send_target, scheduled_for, sent_at, metadata, created_at')
      .eq('id', id).maybeSingle(),
    sb.from('network_newsletter_sections').select('position, heading, body_markdown, source_kind, evidence').eq('newsletter_id', id).order('position', { ascending: true }),
  ]);
  if (!nl) notFound();
  const n = nl as { id: string; title: string; subject_line: string | null; preheader: string | null; for_date: string | null; status: string; send_target: string; scheduled_for: string | null; sent_at: string | null; metadata: Record<string, unknown>; created_at: string };
  const secs = ((sections ?? []) as Array<{ position: number; heading: string | null; body_markdown: string; source_kind: string | null; evidence: Record<string, unknown> }>);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname={`/admin/newsletter/${id}`}>
      <SectionHeader
        eyebrow="Newsletter"
        title={n.title}
        description={<span><StatusBadge state={n.status === 'sent' ? 'success' : 'info'} label={n.status} /> · target <code>{n.send_target}</code> · created {formatRelative(n.created_at)}</span>}
        actions={<Link className="status-badge status-not_connected" href="/admin/newsletter">← All</Link>}
      />
      <Panel title="Email meta" eyebrow="Header">
        <dl style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, fontSize: 13, margin: 0 }}>
          <dt className="col-dim">Subject</dt><dd style={{ margin: 0 }}>{n.subject_line ?? '—'}</dd>
          <dt className="col-dim">Preheader</dt><dd style={{ margin: 0 }}>{n.preheader ?? '—'}</dd>
          <dt className="col-dim">For date</dt><dd style={{ margin: 0 }}>{n.for_date ?? '—'}</dd>
          <dt className="col-dim">Send target</dt><dd style={{ margin: 0 }}><code>{n.send_target}</code> (draft-only in Phase 4; no autosend)</dd>
        </dl>
      </Panel>
      {secs.length === 0 ? (
        <Panel title="No sections" eyebrow="Body"><span className="col-dim">No published articles / movers / brief items met the inclusion thresholds. Compose a new draft later in the week.</span></Panel>
      ) : (
        <Panel title={`Body (${secs.length} section${secs.length === 1 ? '' : 's'})`} eyebrow="Preview">
          {secs.map((s) => (
            <div key={s.position} style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #E6E6E6' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>{s.heading ?? '(no heading)'}</h3>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13, fontFamily: 'inherit' }}>{s.body_markdown}</pre>
              {s.source_kind && <div className="col-dim" style={{ fontSize: 11, marginTop: 6 }}>source: {s.source_kind} · evidence: <code style={{ fontSize: 10 }}>{JSON.stringify(s.evidence).slice(0, 160)}</code></div>}
            </div>
          ))}
        </Panel>
      )}
    </AdminShell>
  );
}
