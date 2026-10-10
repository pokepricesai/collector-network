import Link from 'next/link';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Notice, Panel, SectionHeader, StatusBadge } from '@/components/admin/admin-ui';
import { listTasks, type TaskKind, type TaskSourceCategory } from '@/server/tasks/queries';
import { completeTaskAction, reopenTaskAction } from './actions';
import type { SiteSlug } from '@/server/intelligence/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  searchParams?: Promise<{
    site?: string;
    kind?: string;
    source?: string;
    view?: string;
  }>;
}

const SITE_FILTERS: Array<{ label: string; value: '' | 'network' | SiteSlug }> = [
  { label: 'All',       value: '' },
  { label: 'Network',   value: 'network' },
  { label: 'PokePrices',    value: 'pokemon' },
  { label: 'MTG',       value: 'mtg' },
  { label: 'YGO',       value: 'ygo' },
  { label: 'One Piece', value: 'onepiece' },
  { label: 'Lorcana',   value: 'lorcana' },
];

const KIND_FILTERS: Array<{ label: string; value: '' | TaskKind }> = [
  { label: 'All',        value: '' },
  { label: 'Fix',        value: 'fix' },
  { label: 'Improvement', value: 'improvement' },
];

const SOURCE_FILTERS: Array<{ label: string; value: '' | TaskSourceCategory }> = [
  { label: 'All sources',   value: '' },
  { label: 'Manual',        value: 'manual' },
  { label: 'Intelligence',  value: 'intelligence' },
  { label: 'System',        value: 'system' },
];

export default async function TasksPage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/tasks');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const params = (await searchParams) ?? {};

  const siteParam = (params.site ?? '') as '' | 'network' | SiteSlug;
  const kindParam = (params.kind ?? '') as '' | TaskKind;
  const sourceParam = (params.source ?? '') as '' | TaskSourceCategory;
  const view = (params.view === 'completed' ? 'completed' : 'open');

  const site_id: string | null | undefined =
    siteParam === '' ? undefined :
    siteParam === 'network' ? null :
    sites.find((s) => s.slug === siteParam)?.id ?? undefined;

  const rows = await listTasks(sb, {
    site_id,
    task_kind: kindParam || undefined,
    task_source: sourceParam || undefined,
    statuses: view === 'completed' ? ['completed'] : ['open', 'in_progress', 'waiting'],
    limit: view === 'completed' ? 100 : 500,
  });

  const headline = view === 'completed'
    ? `${rows.length} completed · showing most recent 100`
    : rows.length === 0 ? 'Nothing to do right now.'
      : `${rows.length} open task${rows.length === 1 ? '' : 's'}.`;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/tasks">
      <SectionHeader
        eyebrow="Collector Network OS · Operations"
        title="Tasks"
        description={<>{headline} Manual, Intelligence-generated, and system-generated tasks share this inbox.</>}
      />

      <Panel title="Filters" eyebrow="GET params; shareable">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <FilterGroup label="Site">
            {SITE_FILTERS.map((f) => (
              <FilterLink key={f.value || 'all'} href={buildHref({ site: f.value, kind: kindParam, source: sourceParam, view })} active={siteParam === f.value}>
                {f.label}
              </FilterLink>
            ))}
          </FilterGroup>
          <FilterGroup label="Kind">
            {KIND_FILTERS.map((f) => (
              <FilterLink key={f.value || 'all'} href={buildHref({ site: siteParam, kind: f.value, source: sourceParam, view })} active={kindParam === f.value}>
                {f.label}
              </FilterLink>
            ))}
          </FilterGroup>
          <FilterGroup label="Source">
            {SOURCE_FILTERS.map((f) => (
              <FilterLink key={f.value || 'all'} href={buildHref({ site: siteParam, kind: kindParam, source: f.value, view })} active={sourceParam === f.value}>
                {f.label}
              </FilterLink>
            ))}
          </FilterGroup>
          <FilterGroup label="View">
            <FilterLink href={buildHref({ site: siteParam, kind: kindParam, source: sourceParam, view: 'open' })} active={view === 'open'}>Open</FilterLink>
            <FilterLink href={buildHref({ site: siteParam, kind: kindParam, source: sourceParam, view: 'completed' })} active={view === 'completed'}>Completed</FilterLink>
          </FilterGroup>
        </div>
      </Panel>

      {rows.length === 0 ? (
        <EmptyState
          title={view === 'completed' ? 'No completed tasks in range' : 'No open tasks for the current filters'}
          description={view === 'completed'
            ? 'Only the most recent 100 completed tasks are shown.'
            : 'Click + Task in the top bar to log something you notice, or run Intelligence refresh to pull in current signals.'}
          tone="muted"
        />
      ) : (
        <Panel>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {rows.map((t) => {
              const siteLabel = t.site_id ? (sitesById.get(t.site_id)?.name ?? 'site') : 'Network';
              const isCompleted = t.status === 'completed';
              const priorityTone: 'warning' | 'disabled' | 'normal' =
                t.priority === 'critical' || t.priority === 'high' ? 'warning'
                : t.priority === 'low' ? 'disabled'
                : 'normal';
              const sourceTone: 'info' | 'success' | 'disabled' =
                t.task_source === 'manual' ? 'info'
                : t.task_source === 'intelligence' ? 'success'
                : 'disabled';
              return (
                <li key={t.id} style={{
                  borderBottom: '1px solid var(--admin-border)',
                  padding: '10px 4px',
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  alignItems: 'center',
                  gap: 10,
                  opacity: isCompleted ? 0.65 : 1,
                }}>
                  <form action={isCompleted ? reopenTaskAction : completeTaskAction} style={{ display: 'inline-flex' }}>
                    <input type="hidden" name="task_id" value={t.id} />
                    <button
                      type="submit"
                      className="ui-btn ui-btn--secondary ui-btn--sm"
                      style={{
                        width: 26, height: 26, padding: 0, borderRadius: 6,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 15, fontWeight: 700,
                      }}
                      aria-label={isCompleted ? 'Reopen task' : 'Mark complete'}
                      title={isCompleted ? 'Reopen task' : 'Mark complete'}
                    >
                      {isCompleted ? '↺' : '✓'}
                    </button>
                  </form>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 600,
                      textDecoration: isCompleted ? 'line-through' : 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{t.title}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, fontSize: 11, flexWrap: 'wrap', color: 'var(--admin-text-muted)' }}>
                      <span>{siteLabel}</span>
                      <span>·</span>
                      <StatusBadge state={t.task_kind === 'fix' ? 'failed' : 'info'} label={t.task_kind} />
                      <StatusBadge state={sourceTone} label={t.task_source} />
                      {t.priority !== 'normal' && <StatusBadge state={priorityTone} label={t.priority} />}
                      <span>·</span>
                      <span>{new Date(t.created_at).toISOString().slice(0, 10)}</span>
                      {isCompleted && t.completed_at && (
                        <>
                          <span>·</span>
                          <span>completed {new Date(t.completed_at).toISOString().slice(0, 10)}</span>
                        </>
                      )}
                    </div>
                    {t.description && (
                      <div style={{ fontSize: 12.5, marginTop: 4, color: 'var(--admin-text-muted)', lineHeight: 1.4 }}>
                        {t.description.length > 240 ? t.description.slice(0, 237) + '…' : t.description}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {t.task_source === 'intelligence' && extractIntelligenceLink(t.evidence) && (
                      <Link href="/admin/intelligence" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ fontSize: 11 }}>
                        Intelligence
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {view === 'open' && (
        <Notice tone="info">
          Press <strong>+ Task</strong> in the top bar to log something you noticed. Fix / improvement + site + optional notes is all it takes.
        </Notice>
      )}
    </AdminShell>
  );
}

function extractIntelligenceLink(evidence: Record<string, unknown>): string | null {
  const id = evidence['intelligence_item_id'];
  return typeof id === 'string' ? id : null;
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

function buildHref(args: { site: string; kind: string; source: string; view: string }): string {
  const sp = new URLSearchParams();
  if (args.site) sp.set('site', args.site);
  if (args.kind) sp.set('kind', args.kind);
  if (args.source) sp.set('source', args.source);
  if (args.view && args.view !== 'open') sp.set('view', args.view);
  const qs = sp.toString();
  return qs ? `/admin/tasks?${qs}` : '/admin/tasks';
}
