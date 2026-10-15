import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { siteDisplayName } from '@/lib/display-names';
import { formatRelative } from '@/lib/format';
import { IndexingRowActions } from './IndexingRowActions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Row {
  id: string; site_id: string; title: string; publication_url: string | null; published_at: string | null;
  google_index_requested_at: string | null;
  bing_index_submitted_at: string | null;
  bing_index_submission_response: { ok?: boolean; status?: number; error?: string | null } | null;
}

const OUTSTANDING_HOURS = 24;

export default async function IndexingDashboard() {
  const { admin, sb } = await requireAdmin('/admin/content/indexing');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  const { data } = await sb.from('network_articles')
    .select('id, site_id, title, publication_url, published_at, google_index_requested_at, bing_index_submitted_at, bing_index_submission_response')
    .eq('status', 'published')
    .not('publication_url', 'is', null)
    .order('published_at', { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Row[];

  const nowMs = Date.now();
  const outstandingThresholdMs = OUTSTANDING_HOURS * 3600_000;
  const incomplete = rows.filter((r) => !r.google_index_requested_at || !bingSubmittedOk(r));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/content/indexing">
      <SectionHeader
        eyebrow="Content · Indexing"
        title="Indexing Required"
        description={
          <>
            Published articles whose indexing step isn&apos;t complete. Google is manual via Search Console; Bing auto-submits via IndexNow on publish.
            {' '}Submission ≠ confirmed indexing — the ticks only record the submission step.
          </>
        }
        actions={<Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/content">← Content</Link>}
      />

      <Panel title={`${incomplete.length} article${incomplete.length === 1 ? '' : 's'} outstanding`} eyebrow="Indexing checklist">
        {incomplete.length === 0 ? (
          <EmptyState title="Everything indexed" description="All published articles have both Google + Bing submissions recorded." tone="muted" />
        ) : (
          <Table<Row>
            columns={[
              { key: 'site', header: 'Site', render: (r) => siteDisplayName(sitesById.get(r.site_id)?.slug, 'Network') },
              { key: 'title', header: 'Title', render: (r) => (
                <Link href={`/admin/content/articles/${r.id}`} style={{ fontWeight: 600 }}>{r.title}</Link>
              ) },
              { key: 'url', header: 'Live URL', render: (r) => r.publication_url ? (
                <a href={r.publication_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>{shortenUrl(r.publication_url)} ↗</a>
              ) : '—' },
              { key: 'published', header: 'Published', render: (r) => r.published_at ? formatRelative(r.published_at) : '—' },
              { key: 'google', header: 'Google', render: (r) => (
                <GoogleCell row={r} nowMs={nowMs} outstandingMs={outstandingThresholdMs} />
              ) },
              { key: 'bing', header: 'Bing', render: (r) => (
                <BingCell row={r} nowMs={nowMs} outstandingMs={outstandingThresholdMs} />
              ) },
              { key: 'actions', header: '', render: (r) => <IndexingRowActions articleId={r.id} googleDone={!!r.google_index_requested_at} bingDone={bingSubmittedOk(r)} /> },
            ]}
            rows={incomplete}
          />
        )}
      </Panel>

      <Panel title="Shortcuts" eyebrow="External tools">
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li><a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">Google Search Console</a> — URL inspection → Request indexing (manual, per article).</li>
          <li><a href="https://www.bing.com/webmasters" target="_blank" rel="noopener noreferrer">Bing Webmaster Tools</a> — monitor crawl + indexing status.</li>
          <li>Sitemaps are rebuilt automatically on deploy; Google will crawl new URLs on its own cadence.</li>
        </ul>
      </Panel>
    </AdminShell>
  );
}

function bingSubmittedOk(r: Row): boolean {
  if (!r.bing_index_submitted_at) return false;
  if (r.bing_index_submission_response?.ok === false) return false;
  return true;
}

function GoogleCell({ row, nowMs, outstandingMs }: { row: Row; nowMs: number; outstandingMs: number }) {
  if (row.google_index_requested_at) return <StatusBadge state="success" label="requested" />;
  const publishedMs = row.published_at ? Date.parse(row.published_at) : nowMs;
  const overdue = nowMs - publishedMs > outstandingMs;
  return <StatusBadge state={overdue ? 'pending' : 'info'} label={overdue ? 'outstanding' : 'todo'} />;
}

function BingCell({ row, nowMs, outstandingMs }: { row: Row; nowMs: number; outstandingMs: number }) {
  if (bingSubmittedOk(row)) return <StatusBadge state="success" label="submitted" />;
  if (row.bing_index_submitted_at) return <StatusBadge state="failed" label={`err ${row.bing_index_submission_response?.status ?? ''}`} />;
  const publishedMs = row.published_at ? Date.parse(row.published_at) : nowMs;
  const overdue = nowMs - publishedMs > outstandingMs;
  return <StatusBadge state={overdue ? 'pending' : 'info'} label={overdue ? 'outstanding' : 'todo'} />;
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch { return url; }
}
