import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  listPipelineRows,
  summarise,
  PIPELINE_STAGES,
  STAGE_PROBABILITY,
  type PipelineRow,
} from '@/server/partners/pipeline-queries';
import { listVendorCategories } from '@/server/partners/cn06a-queries';
import { changePartnerStageAction } from '@/server/partners/pipeline-actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const STAGE_COLORS: Record<string, string> = {
  prospect: '#e2e8f0',
  researching: '#e0f2fe',
  ready_to_contact: '#fef3c7',
  contacted: '#dbeafe',
  replied: '#d1fae5',
  meeting: '#c7d2fe',
  proposal: '#fde68a',
  negotiating: '#fed7aa',
  won: '#86efac',
  lost: '#fecaca',
};

const money = (minor: number) => `£${Math.round(minor / 100).toLocaleString()}`;

interface PageProps {
  searchParams: Promise<{ category?: string; tcg?: string; priority?: string; wave?: string }>;
}

function PartnerCard({ r, categoryLabel }: { r: PipelineRow; categoryLabel: (c: string | null) => string }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const overdue = r.next_action_due && r.next_action_due < todayStr;
  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${overdue ? '#ef4444' : '#e5e7eb'}`,
      borderRadius: 6,
      padding: 8,
      marginBottom: 6,
      fontSize: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <Link href={`/admin/partners/${r.id}`} style={{ fontWeight: 600, textDecoration: 'none', color: '#111' }}>
          {r.display_name}
        </Link>
        {r.first_wave && <StatusBadge state="warning" label="W1" />}
      </div>
      <div style={{ color: '#6b7280', marginTop: 2, fontSize: 11 }}>
        {categoryLabel(r.vendor_category)}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4, fontSize: 11, color: '#374151' }}>
        {r.fit_score != null && <span>fit {r.fit_score}</span>}
        {r.estimated_size && <span>· {r.estimated_size}</span>}
        {r.recommended_price_minor != null && <span>· {money(r.recommended_price_minor)}/mo</span>}
      </div>
      {r.next_action_due && (
        <div style={{ marginTop: 4, fontSize: 11, color: overdue ? '#dc2626' : '#374151' }}>
          due {r.next_action_due}{overdue && ' · overdue'}
        </div>
      )}
      <form action={changePartnerStageAction} style={{ marginTop: 6, display: 'flex', gap: 4 }}>
        <input type="hidden" name="id" value={r.id} />
        <select name="status" defaultValue={r.status} style={{ fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3, flex: 1 }}>
          {['prospect','researching','ready_to_contact','contacted','replied','meeting','proposal','negotiating','won','lost','nurture','archived'].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <button type="submit" title="Save stage" style={{ fontSize: 11, padding: '2px 6px', border: '1px solid #d1d5db', borderRadius: 3, background: '#fff', cursor: 'pointer' }}>→</button>
      </form>
    </div>
  );
}

export default async function PipelinePage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/partners/pipeline');
  const sites = await listNetworkSites(sb);
  const sp = await searchParams;
  const filters: Parameters<typeof listPipelineRows>[1] = {};
  if (sp.category) filters.category = sp.category;
  if (sp.tcg) filters.tcg = sp.tcg;
  if (sp.priority) filters.priority = Number(sp.priority);

  const [rowsAll, categories] = await Promise.all([
    listPipelineRows(sb, filters),
    listVendorCategories(sb),
  ]);
  const rows = sp.wave === '1' ? rowsAll.filter((r) => r.first_wave) : rowsAll;

  const categoryLabel = (code: string | null) =>
    code ? (categories.find((c) => c.code === code)?.display_name ?? code) : '—';

  const summary = summarise(rows);
  const totalMonthly = summary.reduce((a, s) => s.stage !== 'won' && s.stage !== 'lost' && s.stage !== 'nurture' && s.stage !== 'archived' ? a + s.monthly_minor : a, 0);
  const totalACV = summary.reduce((a, s) => s.stage !== 'won' && s.stage !== 'lost' && s.stage !== 'nurture' && s.stage !== 'archived' ? a + s.acv_minor : a, 0);
  const weightedACV = summary.reduce((a, s) => a + s.weighted_acv_minor, 0);
  const wonMonthly = summary.find((s) => s.stage === 'won')?.monthly_minor ?? 0;
  const wonACV = summary.find((s) => s.stage === 'won')?.acv_minor ?? 0;

  const byStage = new Map<string, PipelineRow[]>();
  for (const r of rows) {
    const arr = byStage.get(r.status) ?? [];
    arr.push(r);
    byStage.set(r.status, arr);
  }

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/partners/pipeline">
      <SectionHeader
        eyebrow="Sales"
        title="Sponsorship pipeline"
        description="Kanban board of every CN-06A prospect. Change a card's stage from its dropdown; the change is persisted and a note is logged. Weighted ACV uses stage probabilities."
        actions={
          <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/morning">Morning queue</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners">Table view</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/first-wave">First wave</Link>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/partners/categories">Categories</Link>
          </span>
        }
      />

      <Panel title="Pipeline totals" eyebrow="Live summary">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          <div className="metric-card">
            <div className="metric-label">Open pipeline — monthly</div>
            <div className="metric-value metric-value--ok">{money(totalMonthly)}</div>
            <div className="metric-helper">excl. won / lost / nurture</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Open pipeline — ACV</div>
            <div className="metric-value metric-value--ok">{money(totalACV)}</div>
            <div className="metric-helper">12-month projected</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Weighted ACV</div>
            <div className="metric-value metric-value--ok">{money(weightedACV)}</div>
            <div className="metric-helper">by stage probability</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Won monthly</div>
            <div className="metric-value metric-value--ok">{money(wonMonthly)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Won ACV</div>
            <div className="metric-value metric-value--ok">{money(wonACV)}</div>
          </div>
        </div>
      </Panel>

      <Panel title="Filters" eyebrow="Narrow the board">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <Link href="/admin/partners/pipeline"><StatusBadge state={!sp.category && !sp.wave && !sp.tcg && !sp.priority ? 'active' : 'info'} label={`All (${rowsAll.length})`} /></Link>
          <Link href="/admin/partners/pipeline?wave=1"><StatusBadge state={sp.wave === '1' ? 'active' : 'info'} label={`Wave only (${rowsAll.filter((r) => r.first_wave).length})`} /></Link>
          <span style={{ color: '#6b7280', marginLeft: 6 }}>TCG:</span>
          {['pokemon','mtg','ygo','onepiece','lorcana'].map((t) => (
            <Link key={t} href={`/admin/partners/pipeline?tcg=${t}`}><StatusBadge state={sp.tcg === t ? 'active' : 'info'} label={t} /></Link>
          ))}
          <span style={{ color: '#6b7280', marginLeft: 6 }}>Priority:</span>
          {[1,2,3,4,5].map((p) => (
            <Link key={p} href={`/admin/partners/pipeline?priority=${p}`}><StatusBadge state={sp.priority === String(p) ? 'active' : 'info'} label={`P${p}`} /></Link>
          ))}
        </div>
      </Panel>

      <Panel title="Board" eyebrow="Change a card's stage via its dropdown">
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
          {PIPELINE_STAGES.map((stage) => {
            const list = byStage.get(stage) ?? [];
            const sm = summary.find((s) => s.stage === stage);
            return (
              <div key={stage} style={{ flex: '0 0 220px', background: STAGE_COLORS[stage] ?? '#f3f4f6', borderRadius: 6, padding: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                  {stage.replace(/_/g, ' ')} · {list.length}
                </div>
                <div style={{ fontSize: 10, color: '#374151', marginBottom: 6 }}>
                  {sm ? money(sm.monthly_minor) : '£0'}/mo · {Math.round((STAGE_PROBABILITY[stage] ?? 0) * 100)}% weight
                </div>
                {list.map((r) => <PartnerCard key={r.id} r={r} categoryLabel={categoryLabel} />)}
              </div>
            );
          })}
        </div>
      </Panel>
    </AdminShell>
  );
}
