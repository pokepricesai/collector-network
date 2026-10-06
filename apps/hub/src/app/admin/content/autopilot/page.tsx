import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  AUTOPILOT_SITE_SLUGS,
  loadAutopilotSnapshot,
  type AutopilotSiteSlug,
  type AutopilotSnapshot,
} from '@/server/autopilot/config';
import { loadBudgetSnapshot } from '@/server/autopilot/budget';
import {
  toggleGlobalBoolAction,
  updateGlobalNumberAction,
  updateModelAction,
  toggleSiteBoolAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Site readiness, hand-curated for Checkpoint A. Autopilot pilot
// starts on YGO because the ygo_db adapter is fully auto-publish
// capable. Pokemon + MTG are listed as adapter-incomplete so the UI
// explains why their "enabled" switch is suppressed.
const SITE_READINESS: Record<AutopilotSiteSlug, { label: string; status: 'pilot' | 'ready' | 'adapter_incomplete' }> = {
  pokemon:  { label: 'PokePrices',       status: 'adapter_incomplete' },
  mtg:      { label: 'MTGPrices',        status: 'adapter_incomplete' },
  ygo:      { label: 'YGOPrices',        status: 'pilot' },
  onepiece: { label: 'OnePiecePrices',   status: 'ready' },
  lorcana:  { label: 'LorcanaPrices',    status: 'ready' },
};

export default async function AutopilotSettingsPage() {
  const { admin, sb } = await requireAdmin('/admin/content/autopilot');
  const [sites, snapshot, budget] = await Promise.all([
    listNetworkSites(sb),
    loadAutopilotSnapshot(sb),
    loadBudgetSnapshot(sb),
  ]);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/content/autopilot">
      <SectionHeader
        eyebrow="Content · Autopilot"
        title="Article Autopilot"
        description={<>Settings surface for the automated article pipeline. <strong>Everything ships OFF by default.</strong> No paid AI calls, no scheduled generation, no publishing until the master switch and the per-site enable flag are both on AND a human has approved the first run.</>}
      />

      {!snapshot.global.autopilot_enabled && (
        <Notice tone="info">
          <strong>Autopilot is OFF.</strong> The settings below take effect only once you flip the master switch. Nothing will generate or publish until that happens.
        </Notice>
      )}

      <Panel title="Today / this month" eyebrow="Current reservations">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <KV label="Spent today (USD)" value={fmtUsd(budget.spent_today_usd)} warn={budget.spent_today_usd >= snapshot.global.daily_article_budget_usd} />
          <KV label="Daily cap (USD)" value={fmtUsd(snapshot.global.daily_article_budget_usd)} />
          <KV label="Spent this month (USD)" value={fmtUsd(budget.spent_month_usd)} warn={budget.spent_month_usd >= snapshot.global.monthly_article_budget_usd} />
          <KV label="Monthly cap (USD)" value={fmtUsd(snapshot.global.monthly_article_budget_usd)} />
          <KV label="Reservations today" value={String(budget.reservations_today)} />
          <KV label="Reservations this month" value={String(budget.reservations_month)} />
        </div>
      </Panel>

      <Panel title="Global switches" eyebrow="Network-wide">
        <div style={{ display: 'grid', gap: 10 }}>
          <BoolRow label="Autopilot master switch"
                   value={snapshot.global.autopilot_enabled} keyName="autopilot_enabled"
                   helper="When off, no autopilot code runs. All other switches are inert." />
          <BoolRow label="Allow auto-publishing"
                   value={snapshot.global.auto_publish_enabled} keyName="auto_publish_enabled"
                   helper="When off, articles that pass QA stop at the review state instead of publishing." />
          <BoolRow label="Allow refreshes"
                   value={snapshot.global.refreshes_enabled} keyName="refreshes_enabled"
                   helper="When off, autopilot never picks a refresh over writing a new article." />
        </div>
      </Panel>

      <Panel title="Caps and thresholds" eyebrow="Admin-editable budget policy">
        <div style={{ display: 'grid', gap: 12 }}>
          <NumberRow label="Max articles per day" keyName="max_articles_per_day" value={snapshot.global.max_articles_per_day} helper="Hard ceiling on autopilot-produced articles per 24h." step="1" min="0" />
          <NumberRow label="Max cost per article (USD)" keyName="max_cost_per_article_usd" value={snapshot.global.max_cost_per_article_usd} helper="Per-article AI spend cap. Articles exceeding this are held." step="0.01" min="0" />
          <NumberRow label="Daily article budget (USD)" keyName="daily_article_budget_usd" value={snapshot.global.daily_article_budget_usd} helper="Rolling 24h network-wide spend cap." step="0.01" min="0" />
          <NumberRow label="Monthly article budget (USD)" keyName="monthly_article_budget_usd" value={snapshot.global.monthly_article_budget_usd} helper="Rolling month-to-date network-wide spend cap." step="0.01" min="0" />
          <NumberRow label="Minimum opportunity score" keyName="min_opportunity_score" value={snapshot.global.min_opportunity_score} helper="Opportunities below this score never consume generation budget." step="1" min="0" />
        </div>
      </Panel>

      <Panel title="Model configuration" eyebrow="Cheap-first; expensive only when justified">
        <div style={{ display: 'grid', gap: 14 }}>
          <ModelRow label="Default draft model" keyName="default_draft_model" model={snapshot.global.default_draft_model} helper="Primary draft generation model. Haiku-first keeps per-article cost well under the ceiling." />
          <ModelRow label="Fallback model"      keyName="fallback_model"      model={snapshot.global.fallback_model}      helper="Only used when deterministic checks say the draft is low-quality AND budget allows a retry." />
          <ModelRow label="Semantic QA model"   keyName="semantic_qa_model"   model={snapshot.global.semantic_qa_model}   helper="Optional one-shot QA pass. Skipped if it would push the article over the per-article cap." />
        </div>
      </Panel>

      <Panel title="Per-site switches" eyebrow="Pilot = YGO · others held during pilot">
        <Table
          columns={[
            { key: 'site', header: 'Site', render: (r: SiteRow) => (
              <span>
                <strong>{r.label}</strong>{' '}
                <code className="col-dim" style={{ fontSize: 11 }}>{r.slug}</code>
              </span>
            ) },
            { key: 'readiness', header: 'Readiness', render: (r: SiteRow) =>
              r.readiness === 'pilot' ? <StatusBadge state="info" label="PILOT" /> :
              r.readiness === 'ready' ? <StatusBadge state="success" label="publish-capable" /> :
              <StatusBadge state="warning" label="adapter incomplete" /> },
            { key: 'enabled', header: 'Enabled', render: (r: SiteRow) => (
              <form action={toggleSiteBoolAction} style={{ display: 'inline' }}>
                <input type="hidden" name="slug" value={r.slug} />
                <input type="hidden" name="key" value="enabled" />
                <input type="hidden" name="value" value={(!r.config.enabled).toString()} />
                <button type="submit" className="admin-btn" style={{ padding: '4px 10px', fontSize: 12 }}>
                  {r.config.enabled ? 'ON' : 'off'}
                </button>
              </form>
            ) },
            { key: 'publish', header: 'Auto-publish allowed', render: (r: SiteRow) => (
              <form action={toggleSiteBoolAction} style={{ display: 'inline' }}>
                <input type="hidden" name="slug" value={r.slug} />
                <input type="hidden" name="key" value="auto_publish_allowed" />
                <input type="hidden" name="value" value={(!r.config.auto_publish_allowed).toString()} />
                <button type="submit" className="admin-btn" style={{ padding: '4px 10px', fontSize: 12 }}>
                  {r.config.auto_publish_allowed ? 'ON' : 'off'}
                </button>
              </form>
            ) },
            { key: 'notes', header: 'Notes', render: (r: SiteRow) => <span style={{ fontSize: 12 }}>{readinessNote(r.readiness)}</span> },
          ]}
          rows={AUTOPILOT_SITE_SLUGS.map((slug) => ({
            id: slug,
            slug,
            label: SITE_READINESS[slug].label,
            readiness: SITE_READINESS[slug].status,
            config: snapshot.sites[slug],
          }))}
          empty=""
        />
      </Panel>

      <Panel title="Emergency stop" eyebrow="Fastest path back to safe state">
        <p className="col-dim" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
          Turning the master switch OFF above halts all autopilot behaviour immediately. The pipeline re-checks this flag before every single step, so switching off takes effect on the next evaluation (typically within seconds).
        </p>
        <p className="col-dim" style={{ fontSize: 12.5, margin: 0 }}>
          Any article mid-generation at that moment will be held with reason <code>autopilot_disabled</code> and appear on <a href="/admin/content/holds">/admin/content/holds</a>.
        </p>
      </Panel>
    </AdminShell>
  );
}

function readinessNote(r: 'pilot' | 'ready' | 'adapter_incomplete'): string {
  switch (r) {
    case 'pilot':               return 'Designated first paid pilot. ygo_db publishes directly to the live site.';
    case 'ready':               return 'Publish-capable via DB adapter; keep disabled until YGO pilot proves cost + quality.';
    case 'adapter_incomplete':  return 'Current adapter requires manual operator handoff; cannot auto-publish today.';
  }
}

function BoolRow({ label, value, keyName, helper }: { label: string; value: boolean; keyName: string; helper: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', border: '1px solid var(--admin-border)', borderRadius: 'var(--radius-md)', background: 'var(--admin-surface)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div className="col-dim" style={{ fontSize: 12 }}>{helper}</div>
      </div>
      <form action={toggleGlobalBoolAction}>
        <input type="hidden" name="key" value={keyName} />
        <input type="hidden" name="value" value={(!value).toString()} />
        <button type="submit" className="admin-btn" style={{ padding: '4px 12px', fontSize: 12 }}>
          {value ? 'ON' : 'off'}
        </button>
      </form>
    </div>
  );
}

function NumberRow({ label, keyName, value, helper, step, min }: { label: string; keyName: string; value: number; helper: string; step: string; min: string }) {
  return (
    <form action={updateGlobalNumberAction} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', border: '1px solid var(--admin-border)', borderRadius: 'var(--radius-md)', background: 'var(--admin-surface)' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div className="col-dim" style={{ fontSize: 12 }}>{helper}</div>
      </div>
      <input type="hidden" name="key" value={keyName} />
      <input type="number" name="value" step={step} min={min} defaultValue={value} style={{ width: 110, padding: '4px 8px', fontSize: 13, border: '1px solid var(--admin-border)', borderRadius: 4 }} />
      <button type="submit" className="admin-btn" style={{ padding: '4px 10px', fontSize: 12 }}>Save</button>
    </form>
  );
}

function ModelRow({ label, keyName, model, helper }: { label: string; keyName: string; model: { provider: string; model: string; max_output_tokens: number }; helper: string }) {
  return (
    <form action={updateModelAction} style={{ padding: 10, border: '1px solid var(--admin-border)', borderRadius: 'var(--radius-md)', background: 'var(--admin-surface)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{label}</div>
      <div className="col-dim" style={{ fontSize: 12, marginBottom: 8 }}>{helper}</div>
      <input type="hidden" name="key" value={keyName} />
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 130px auto', gap: 8, alignItems: 'center' }}>
        <label style={{ fontSize: 12 }}>Provider</label>
        <input type="text" name="provider" defaultValue={model.provider} style={{ padding: '4px 8px', fontSize: 13, border: '1px solid var(--admin-border)', borderRadius: 4 }} />
        <label style={{ fontSize: 12, gridColumn: '1' }}>Model</label>
        <input type="text" name="model" defaultValue={model.model} style={{ padding: '4px 8px', fontSize: 13, border: '1px solid var(--admin-border)', borderRadius: 4 }} />
        <label style={{ fontSize: 12, gridColumn: '1' }}>Max output tokens</label>
        <input type="number" name="max_output_tokens" defaultValue={model.max_output_tokens} min={1} step={1} style={{ padding: '4px 8px', fontSize: 13, border: '1px solid var(--admin-border)', borderRadius: 4 }} />
        <div />
        <div />
        <button type="submit" className="admin-btn" style={{ padding: '4px 12px', fontSize: 12, gridColumn: '3 / span 2', justifySelf: 'end' }}>Save</button>
      </div>
    </form>
  );
}

interface SiteRow {
  id: string;
  slug: AutopilotSiteSlug;
  label: string;
  readiness: 'pilot' | 'ready' | 'adapter_incomplete';
  config: AutopilotSnapshot['sites'][AutopilotSiteSlug];
}

function KV({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{
      border: '1px solid var(--admin-border)',
      borderRadius: 'var(--radius-md)',
      padding: '8px 10px',
      background: warn ? 'var(--warning-soft)' : 'var(--admin-surface)',
    }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-subtle)', fontWeight: 700, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: warn ? 'var(--warning)' : 'var(--admin-text)' }}>{value}</div>
    </div>
  );
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}
