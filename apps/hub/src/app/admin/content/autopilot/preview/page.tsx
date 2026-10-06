import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { previewPipeline } from '@/server/autopilot/pipeline';
import { HOLD_REASON_LABELS } from '@/server/autopilot/holds';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

// Checkpoint B preview page — picks the top YGO opportunity, builds
// the real evidence pack + cost estimate + fixture draft + QA, and
// shows the whole thing. NO paid AI, NO publishing, NO budget
// reservation. The fixture draft is explicitly labelled so Luke
// never confuses it with real AI output.

export default async function AutopilotPreviewPage() {
  const { admin, sb } = await requireAdmin('/admin/content/autopilot/preview');
  const sites = await listNetworkSites(sb);
  const preview = await previewPipeline({ sb, site_slug: 'ygo' });

  const outcomeTone =
    preview.pipeline.outcome === 'ready_for_first_paid_run' ? 'success' :
    preview.pipeline.outcome === 'ready_to_publish' ? 'success' :
    'warning';

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/content/autopilot/preview">
      <SectionHeader
        eyebrow="Content · Autopilot · Preview (fixture)"
        title="YGO autopilot — first-run preview"
        description={<>End-to-end preview of what the autopilot would do with the top YGO opportunity. <strong>Fixture mode: no AI call, no budget reserved, no publishing.</strong> The fixture draft is deterministically rendered from the evidence pack so the downstream QA + body_rich pipeline is exercised without model spend.</>}
        actions={<Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/content/autopilot">Autopilot settings</Link>}
      />

      <Panel title="Pipeline outcome" eyebrow="End of fixture dry-run">
        <Notice tone={outcomeTone}>
          <strong style={{ textTransform: 'uppercase' }}>{preview.pipeline.outcome.replace(/_/g, ' ')}</strong>
          {preview.stop_reason && <> — {preview.stop_reason}</>}
        </Notice>
        {preview.pipeline.hold_reasons.length > 0 && (
          <ul style={{ fontSize: 13, lineHeight: 1.6, margin: '10px 0 0', paddingLeft: 20 }}>
            {preview.pipeline.hold_reasons.map((r) => (
              <li key={r}>
                <code>{r}</code>{' · '}{HOLD_REASON_LABELS[r]?.title ?? '(unknown reason)'}
                {HOLD_REASON_LABELS[r]?.resolution && (
                  <> <span className="col-dim">— {HOLD_REASON_LABELS[r]!.resolution}</span></>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="1. Selected opportunity" eyebrow="Top-scored YGO idea in the queue">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          <KV label="Working title" value={preview.pipeline.opportunity.working_title} />
          <KV label="Template" value={preview.pipeline.opportunity.template_id} />
          <KV label="Score (0..100)" value={preview.pipeline.opportunity.score.total.toString()} />
          <KV label="Decision" value={preview.pipeline.opportunity.routing.decision} />
          <KV label="Routing reason" value={preview.pipeline.opportunity.routing.reason} />
          <KV label="Target article (refresh)" value={preview.pipeline.opportunity.routing.target_article_id ?? '—'} />
        </div>

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Score breakdown</h3>
        <Table
          columns={[
            { key: 'c', header: 'Component',  render: (r: BreakdownRow) => <code>{r.component}</code> },
            { key: 'v', header: 'Value',      className: 'num', render: (r: BreakdownRow) => r.value.toString() },
            { key: 'm', header: 'Max',        className: 'num', render: (r: BreakdownRow) => r.max.toString() },
          ]}
          rows={scoreBreakdownRows(preview.pipeline.opportunity.score.components)}
          empty=""
        />

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Why this score</h3>
        <ul style={{ fontSize: 13, lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
          {preview.pipeline.opportunity.score.rationale.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </Panel>

      <Panel title="1b. Candidate pool" eyebrow="All candidates considered, highest score first">
        <p className="col-dim" style={{ fontSize: 12.5, margin: '0 0 10px' }}>
          <strong>Discovery:</strong>{' '}
          {preview.discovery.enabled_sources} enabled source(s); {preview.discovery.total_active_signals} active signal(s).
          Last pass: {preview.discovery.cached
            ? `cached (${preview.discovery.cache_age_minutes} min ago)`
            : `fresh — scanned ${preview.discovery.sources_scanned} source(s), ${preview.discovery.signals_inserted} new signal(s)`}
          {preview.discovery.errors.length > 0 && <>, {preview.discovery.errors.length} error(s)</>}.
        </p>
        {preview.candidates.length === 0 ? (
          <p className="col-dim" style={{ fontSize: 13, margin: 0 }}>No candidates. Enable sources at <Link href="/admin/content/autopilot/sources">/admin/content/autopilot/sources</Link> and refresh.</p>
        ) : (
          <Table
            columns={[
              { key: 'r',  header: '#',       className: 'num', render: (r: CandRow) => String(r.rank) },
              { key: 'k',  header: 'Kind',    render: (r: CandRow) => r.kind === 'external_cluster'
                ? <StatusBadge state="warning" label="external" />
                : <StatusBadge state="info" label="internal" /> },
              { key: 's',  header: 'Score',   className: 'num', render: (r: CandRow) => <strong>{r.score.toString()}</strong> },
              { key: 't',  header: 'Template', render: (r: CandRow) => <code style={{ fontSize: 11 }}>{r.template_id}</code> },
              { key: 'd',  header: 'Decision', render: (r: CandRow) => <code style={{ fontSize: 11 }}>{r.decision}</code> },
              { key: 'tt', header: 'Working title', render: (r: CandRow) => <span style={{ fontSize: 13 }}>{r.working_title}</span> },
              { key: 'tiers', header: 'Supporting tiers', render: (r: CandRow) =>
                r.kind === 'external_cluster' && r.tiers.length > 0
                  ? r.tiers.map((t, i) => <code key={i} style={{ marginRight: 4, fontSize: 10 }}>{t[0]}</code>)
                  : <span className="col-dim">—</span> },
            ]}
            rows={preview.candidates.map((c, i) => ({
              id: `${c.kind}:${c.key}`,
              rank: i + 1,
              kind: c.kind,
              score: c.score,
              template_id: c.template_id,
              decision: c.decision,
              working_title: c.working_title,
              tiers: c.supporting_source_tiers,
            }))}
            empty=""
          />
        )}
      </Panel>

      <Panel title="2. Evidence pack" eyebrow="Deterministic — the AI reads only this">
        <Notice tone={preview.evidence_quality.status === 'ready' ? 'success' : 'warning'}>
          <strong style={{ textTransform: 'uppercase' }}>Evidence quality: {preview.evidence_quality.status}</strong>
          {preview.evidence_quality.hold_reasons.length > 0 && <> — {preview.evidence_quality.hold_reasons.join(', ')}</>}
        </Notice>
        {preview.evidence_quality.warnings.length > 0 && (
          <ul style={{ fontSize: 12.5, lineHeight: 1.6, margin: '8px 0 0', paddingLeft: 20, color: 'var(--admin-text-muted)' }}>
            {preview.evidence_quality.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
          <KV label="Market observations" value={preview.pipeline.evidence_pack.market_data.length.toString()} warn={preview.pipeline.evidence_pack.market_data.length === 0} />
          <KV label="Search observations" value={preview.pipeline.evidence_pack.search_data.length.toString()} />
          <KV label="Related pages" value={preview.pipeline.evidence_pack.related_pages.length.toString()} />
          <KV label="Internal link candidates" value={preview.pipeline.evidence_pack.internal_links.length.toString()} />
          <KV label="Existing similar articles" value={preview.pipeline.evidence_pack.existing_content.length.toString()} />
          <KV label="Images available" value={preview.pipeline.evidence_pack.images.length.toString()} warn={preview.pipeline.evidence_pack.images.length === 0} />
          <KV label="Commercial links" value={preview.pipeline.evidence_pack.commercial_links.length.toString()} />
          <KV label="Date range" value={`${preview.pipeline.evidence_pack.date_range.from} → ${preview.pipeline.evidence_pack.date_range.to}`} />
        </div>

        {preview.pipeline.evidence_pack.market_data.length === 0 && preview.pipeline.opportunity.template_id === 'market_movers' && (
          <Notice tone="info" >
            <strong>YGO pricing not mirrored in the Collector Network Supabase yet.</strong> MARKET_MOVERS cannot run for YGO today;
            evidence builder returns an empty <code>market_data</code> array, which the quality gate catches as <code>evidence_insufficient</code>.
          </Notice>
        )}

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Methodology</h3>
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>{preview.pipeline.evidence_pack.methodology}</p>

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Article angle (deterministic)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          <KV label="Anchor" value={preview.pipeline.evidence_pack.article_angle.anchor} />
          <KV label="Dominant source tier" value={preview.pipeline.evidence_pack.article_angle.dominant_tier} />
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.6, margin: '10px 0 6px' }}><strong>One line:</strong> {preview.pipeline.evidence_pack.article_angle.one_line}</p>
        {preview.pipeline.evidence_pack.article_angle.must_cover.length > 0 && (
          <>
            <div className="admin-eyebrow" style={{ marginBottom: 4 }}>Must cover</div>
            <ul style={{ fontSize: 12.5, margin: 0, paddingLeft: 20 }}>
              {preview.pipeline.evidence_pack.article_angle.must_cover.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </>
        )}
        {preview.pipeline.evidence_pack.article_angle.must_not_cover.length > 0 && (
          <>
            <div className="admin-eyebrow" style={{ marginTop: 8, marginBottom: 4 }}>Must NOT cover</div>
            <ul style={{ fontSize: 12.5, margin: 0, paddingLeft: 20, color: 'var(--admin-text-muted)' }}>
              {preview.pipeline.evidence_pack.article_angle.must_not_cover.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </>
        )}

        <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>External sources</h3>
        {preview.pipeline.evidence_pack.external_sources.length === 0 ? (
          <p className="col-dim" style={{ fontSize: 13, margin: 0 }}>No external sources — article is wholly internally-grounded.</p>
        ) : (
          <Table
            columns={[
              { key: 't',  header: 'Tier', render: (r: ExtSrcRow) => <StatusBadge state={r.tier === 'official' ? 'success' : r.tier === 'secondary' ? 'info' : 'warning'} label={r.tier} /> },
              { key: 'p',  header: 'Publisher', render: (r: ExtSrcRow) => <strong>{r.publisher}</strong> },
              { key: 'd',  header: 'Published', render: (r: ExtSrcRow) => <code style={{ fontSize: 11 }}>{r.published_at ?? '—'}</code> },
              { key: 'h',  header: 'Headline', render: (r: ExtSrcRow) => <span style={{ fontSize: 12.5 }}>{r.headline}</span> },
              { key: 'u',  header: 'URL', render: (r: ExtSrcRow) => <code style={{ fontSize: 10 }}>{r.url.length > 50 ? r.url.slice(0, 47) + '…' : r.url}</code> },
            ]}
            rows={preview.pipeline.evidence_pack.external_sources.map((s, i) => ({ id: i, tier: s.source_tier, publisher: s.publisher, published_at: s.published_at, headline: s.headline, url: s.url }))}
            empty=""
          />
        )}
      </Panel>

      <Panel title="3. Images chosen" eyebrow="YGO card imagery only — no AI generation, no web scraping">
        {preview.pipeline.evidence_pack.images.length === 0 ? (
          <p className="col-dim" style={{ fontSize: 13, margin: 0 }}>No eligible images.</p>
        ) : (
          <Table
            columns={[
              { key: 'r', header: 'Role',     render: (r: ImgRow) => <StatusBadge state={r.role === 'featured' ? 'success' : 'info'} label={r.role ?? 'inline'} /> },
              { key: 'a', header: 'Alt text', render: (r: ImgRow) => <span style={{ fontSize: 12.5 }}>{r.alt}</span> },
              { key: 'u', header: 'URL',      render: (r: ImgRow) => <code style={{ fontSize: 11 }}>{r.url.length > 80 ? r.url.slice(0, 77) + '…' : r.url}</code> },
            ]}
            rows={preview.pipeline.evidence_pack.images.map((i, idx) => ({ id: idx, role: i.role_suggestion, alt: i.alt_text, url: i.source_url }))}
            empty=""
          />
        )}
      </Panel>

      <Panel title="4. Internal link candidates" eyebrow="Outbound links the article may include">
        {preview.pipeline.evidence_pack.internal_links.length === 0 ? (
          <p className="col-dim" style={{ fontSize: 13, margin: 0 }}>No link candidates sourced yet. A follow-up checkpoint will plug in <code>network_internal_link_opportunities</code>.</p>
        ) : (
          <Table
            columns={[
              { key: 'u', header: 'Target URL', render: (r: LinkRow) => <code style={{ fontSize: 11 }}>{r.url}</code> },
              { key: 'a', header: 'Anchor concepts', render: (r: LinkRow) => <span style={{ fontSize: 12.5 }}>{r.anchors.join(', ')}</span> },
              { key: 'r', header: 'Reason',     render: (r: LinkRow) => <code>{r.reason}</code> },
              { key: 'p', header: 'Priority',   className: 'num', render: (r: LinkRow) => r.priority.toString() },
            ]}
            rows={preview.pipeline.evidence_pack.internal_links.map((l, i) => ({ id: i, url: l.target_url, anchors: l.anchor_concepts, reason: l.reason, priority: l.priority }))}
            empty=""
          />
        )}
      </Panel>

      <Panel title="5. Cost estimate + budget" eyebrow="No reservation made in fixture mode">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <KV label="Projected total (USD)" value={fmtUsd(preview.pipeline.budget_preview.projected_cost_usd)} warn={preview.pipeline.budget_preview.projected_cost_usd > preview.pipeline.budget_preview.per_article_cap_usd} />
          <KV label="Per-article cap (USD)" value={fmtUsd(preview.pipeline.budget_preview.per_article_cap_usd)} />
          <KV label="Daily remaining (USD)" value={fmtUsd(preview.pipeline.budget_preview.daily_remaining_usd)} />
          <KV label="Monthly remaining (USD)" value={fmtUsd(preview.pipeline.budget_preview.monthly_remaining_usd)} />
        </div>
      </Panel>

      <Panel title="6. Generation plan" eyebrow="What the paid run would do">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <KV label="Template" value={preview.pipeline.opportunity.template_id} />
          <KV label="Max output tokens" value={preview.pipeline.evidence_pack.generation_constraints.max_output_tokens.toString()} />
          <KV label="Target word count" value={`${preview.pipeline.evidence_pack.generation_constraints.target_word_count_min}–${preview.pipeline.evidence_pack.generation_constraints.target_word_count_max}`} />
          <KV label="Banned phrases enforced" value={preview.pipeline.evidence_pack.generation_constraints.banned_phrases.length.toString()} />
        </div>
      </Panel>

      <Panel title="7. Fixture draft (deterministic rendering)" eyebrow="NOT the real AI output">
        <Notice tone="info">
          <strong>This is NOT what a paid AI run will produce.</strong>{' '}
          The fixture renders the evidence pack directly, so the body_rich converter and the deterministic QA layer can be exercised end-to-end without spending money. Real prose only exists after the first paid model call Luke explicitly approves.
        </Notice>

        {preview.pipeline.draft ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 12 }}>
              <KV label="Title" value={preview.pipeline.draft.title} />
              <KV label="Slug" value={preview.pipeline.draft.slug} />
              <KV label="Meta title" value={`${preview.pipeline.draft.meta_title} (${preview.pipeline.draft.meta_title.length})`} />
              <KV label="Meta description" value={`${preview.pipeline.draft.meta_description.length} chars`} />
              <KV label="Sections" value={preview.pipeline.draft.sections.length.toString()} />
              <KV label="Featured image" value={preview.pipeline.draft.featured_image_source_url ? 'yes' : 'none'} />
            </div>

            <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Rendered sections</h3>
            {preview.pipeline.draft.sections.map((s) => (
              <div key={s.id} style={{ border: '1px solid var(--admin-border)', borderRadius: 'var(--radius-md)', padding: 10, marginBottom: 10 }}>
                {s.heading && (
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-subtle)', fontWeight: 700, marginBottom: 4 }}>
                    H{s.heading_level ?? 2} · {s.id}
                  </div>
                )}
                {s.heading && <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{s.heading}</div>}
                {s.paragraphs.map((p, i) => <p key={i} style={{ fontSize: 13, lineHeight: 1.55, margin: '0 0 6px' }}>{p}</p>)}
                {s.internal_links.length > 0 && (
                  <div className="col-dim" style={{ fontSize: 11, marginTop: 4 }}>
                    Links: {s.internal_links.map((l) => l.anchor).join(', ')}
                  </div>
                )}
                {s.images.length > 0 && (
                  <div className="col-dim" style={{ fontSize: 11, marginTop: 4 }}>
                    Image: {s.images[0]?.alt_text ?? ''}
                  </div>
                )}
              </div>
            ))}
          </>
        ) : (
          <p className="col-dim" style={{ fontSize: 13, margin: '10px 0 0' }}>No draft was produced — the pipeline stopped before executor (see hold reasons above).</p>
        )}
      </Panel>

      <Panel title="8. Deterministic QA" eyebrow="Checks run against the fixture draft">
        {preview.pipeline.qa ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <KV label="Blockers" value={preview.pipeline.qa.blocker_count.toString()} warn={preview.pipeline.qa.blocker_count > 0} />
              <KV label="Warnings" value={preview.pipeline.qa.warning_count.toString()} />
              <KV label="Info" value={preview.pipeline.qa.info_count.toString()} />
              <KV label="Auto-repairs" value={preview.pipeline.qa.auto_repairs_applied.length.toString()} />
            </div>
            {preview.pipeline.qa.findings.length > 0 && (
              <>
                <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Findings</h3>
                <Table
                  columns={[
                    { key: 's', header: 'Severity', render: (r: QARow) => <StatusBadge state={r.severity === 'blocker' ? 'failed' : r.severity === 'warning' ? 'warning' : 'info'} label={r.severity} /> },
                    { key: 'c', header: 'Check',    render: (r: QARow) => <code>{r.check}</code> },
                    { key: 'm', header: 'Message',  render: (r: QARow) => <span style={{ fontSize: 12.5 }}>{r.message}</span> },
                  ]}
                  rows={preview.pipeline.qa.findings.map((f, i) => ({ id: i, severity: f.severity, check: f.check_name, message: f.message }))}
                  empty=""
                />
              </>
            )}
            {preview.pipeline.qa.auto_repairs_applied.length > 0 && (
              <>
                <h3 className="admin-eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Auto-repairs applied</h3>
                <ul style={{ fontSize: 12.5, margin: 0, paddingLeft: 20 }}>
                  {preview.pipeline.qa.auto_repairs_applied.map((r, i) => <li key={i}><code>{r.check_name}</code>: {r.action}</li>)}
                </ul>
              </>
            )}
          </>
        ) : (
          <p className="col-dim" style={{ fontSize: 13 }}>QA did not run (pipeline stopped earlier).</p>
        )}
      </Panel>

      <Panel title="9. body_rich preview (TipTap JSON)" eyebrow="What the publisher adapter would persist">
        {preview.body_rich ? (
          <pre style={{ background: 'var(--admin-surface-strong)', padding: 10, borderRadius: 6, fontSize: 11, maxHeight: 320, overflow: 'auto', fontFamily: 'var(--admin-font-mono)' }}>
            {JSON.stringify(preview.body_rich, null, 2)}
          </pre>
        ) : (
          <p className="col-dim" style={{ fontSize: 13 }}>No body_rich — pipeline stopped before draft.</p>
        )}
      </Panel>

      <Panel title="10. First paid-run approval checklist" eyebrow="Required before any real AI call">
        <ol style={{ fontSize: 13, lineHeight: 1.7, margin: 0, paddingLeft: 24 }}>
          <li>Confirm the opportunity above is the correct first subject.</li>
          <li>Confirm the evidence pack is sufficient for the template.</li>
          <li>Confirm images + internal links look right.</li>
          <li>Confirm projected cost (${preview.pipeline.budget_preview.projected_cost_usd.toFixed(4)}) ≤ per-article cap (${preview.pipeline.budget_preview.per_article_cap_usd.toFixed(2)}).</li>
          <li>Confirm model selection ({preview.pipeline.evidence_pack.generation_constraints.template_id} on default_draft_model).</li>
          <li>Flip <code>autopilot_enabled=true</code> at <Link href="/admin/content/autopilot">/admin/content/autopilot</Link> AND explicitly approve the first run.</li>
        </ol>
        <p className="col-dim" style={{ fontSize: 12, marginTop: 10 }}>
          Checkpoint B stops before any paid call. The first paid draft lands in Checkpoint C.
        </p>
      </Panel>
    </AdminShell>
  );
}

interface BreakdownRow { id: string; component: string; value: number; max: number }
function scoreBreakdownRows(c: {
  search_potential: number; market_significance: number; timeliness: number; evidence_quality: number;
  commercial_relevance: number; internal_link_opportunity: number; existing_content_gap: number;
  newsworthiness: number; source_authority: number;
  duplication_penalty: number; source_agreement_penalty: number; effort_adjustment: number;
}): BreakdownRow[] {
  return [
    { id: 'search',   component: 'Search potential',          value: c.search_potential,          max: 15 },
    { id: 'market',   component: 'Market significance',       value: c.market_significance,       max: 15 },
    { id: 'time',     component: 'Timeliness',                value: c.timeliness,                max: 10 },
    { id: 'ev',       component: 'Evidence quality',          value: c.evidence_quality,          max: 10 },
    { id: 'comm',     component: 'Commercial relevance',      value: c.commercial_relevance,      max: 10 },
    { id: 'links',    component: 'Internal-link opportunity', value: c.internal_link_opportunity, max: 10 },
    { id: 'gap',      component: 'Existing-content gap',      value: c.existing_content_gap,      max: 10 },
    { id: 'news',     component: 'Newsworthiness',            value: c.newsworthiness,            max: 10 },
    { id: 'auth',     component: 'Source authority',          value: c.source_authority,          max: 10 },
    { id: 'dup',      component: 'Duplication penalty',       value: c.duplication_penalty,       max: 0 },
    { id: 'agree',    component: 'Source-agreement penalty',  value: c.source_agreement_penalty,  max: 0 },
    { id: 'effort',   component: 'Effort adjustment',         value: c.effort_adjustment,         max: 5 },
  ];
}

interface ImgRow { id: number; role: string | null; alt: string; url: string }
interface LinkRow { id: number; url: string; anchors: string[]; reason: string; priority: number }
interface QARow { id: number; severity: string; check: string; message: string }
interface CandRow { id: string; rank: number; kind: 'internal_idea' | 'external_cluster'; score: number; template_id: string; decision: string; working_title: string; tiers: string[] }
interface ExtSrcRow { id: number; tier: string; publisher: string; published_at: string | null; headline: string; url: string }

function KV({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{
      border: '1px solid var(--admin-border)',
      borderRadius: 'var(--radius-md)',
      padding: '8px 10px',
      background: warn ? 'var(--warning-soft)' : 'var(--admin-surface)',
    }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-subtle)', fontWeight: 700, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: warn ? 'var(--warning)' : 'var(--admin-text)' }}>{value}</div>
    </div>
  );
}

function fmtUsd(n: number): string { return `$${n.toFixed(4)}`; }
