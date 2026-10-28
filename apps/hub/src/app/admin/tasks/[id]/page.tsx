import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Notice } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  generateClaudePromptAction,
  recordClaudeImplementationAction,
  confirmReceiptVerifiedAction,
  freezeBaselineAction,
} from './actions';
import { completeTaskAction, reopenTaskAction } from '../actions';
import type { ImplementationReceiptStored } from '@/server/claude/completion-receipt';
import type { BaselineSnapshot } from '@/server/claude/baseline';
import {
  type Checkpoint,
  type MeasurementSchedule,
  deriveMeasurementState,
  summariseOutcome,
  CHECKPOINTS,
  addDays,
  SETTLE_LAG_DAYS,
} from '@/server/intelligence/measurement';

// CN-05 OS Phase 2 — task detail page.
//
// Minimal operational surface:
//   * Task metadata + description
//   * Linked Intelligence item summary when sourced from it
//   * "Generate Claude Code Prompt" button → runs the deterministic
//     builder on the server, stores the prompt in
//     network_tasks.metadata.generated_prompts, and renders a
//     copy-able textarea.
//   * Open / Complete toggle, matching the list page.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Props { params: Promise<{ id: string }> }

type GeneratedPrompt = {
  prompt_version?: string;
  prompt_hash?: string;
  implementation_type?: string;
  created_at?: string;
  prompt_text?: string;
};

export default async function TaskDetailPage({ params }: Props) {
  const { id } = await params;
  const { admin, sb } = await requireAdmin(`/admin/tasks/${id}`);
  const sites = await listNetworkSites(sb);

  const { data: task, error } = await sb
    .from('network_tasks')
    .select('id, title, description, priority, status, site_id, task_type, task_kind, task_source, evidence, metadata, recommended_action, created_at, completed_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`[tasks/[id]] load: ${error.message}`);
  if (!task) notFound();

  const site = task.site_id ? sites.find((s) => s.id === task.site_id) ?? null : null;

  // Linked Intelligence item (via evidence.intelligence_item_id).
  const intelId = (task.evidence as { intelligence_item_id?: unknown } | null)?.intelligence_item_id;
  let intel: {
    id: string;
    category: string;
    type: string | null;
    signal_kind: string | null;
    title: string;
    summary: string | null;
    recommended_action: string | null;
    priority_score: number | null;
  } | null = null;
  if (typeof intelId === 'string') {
    const { data } = await sb
      .from('network_intelligence_items')
      .select('id, category, type, signal_kind, title, summary, recommended_action, priority_score')
      .eq('id', intelId)
      .maybeSingle();
    intel = data ?? null;
  }

  const isCompleted = task.status === 'completed';
  const meta = (task.metadata ?? {}) as {
    generated_prompts?: GeneratedPrompt[];
    implementation_receipts?: ImplementationReceiptStored[];
    receipt_last_error?: { at: string; message: string; path?: string };
    baseline?: BaselineSnapshot;
    measurement_schedule?: MeasurementSchedule;
    measurement_checkpoints?: Checkpoint[];
  };
  const prompts = meta.generated_prompts ?? [];
  const latestPrompt = prompts[0];
  const receipts = meta.implementation_receipts ?? [];
  const latestReceipt = receipts[0];
  const receiptError = meta.receipt_last_error;
  const operatorVerified = latestReceipt?.operator_confirmed_at != null;
  const baseline = meta.baseline ?? null;
  const schedule = meta.measurement_schedule ?? null;
  const checkpoints = meta.measurement_checkpoints ?? [];
  const measurementState = deriveMeasurementState(meta);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/tasks">
      <SectionHeader
        eyebrow="Collector Network OS · Task"
        title={task.title}
        description={
          <>
            {site?.name ?? 'Network'} · <code>{task.task_type}</code> · {task.task_kind} · priority {task.priority}
            {task.task_source && <> · source {task.task_source}</>}
          </>
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/tasks">Back to list</Link>
            <form action={isCompleted ? reopenTaskAction : completeTaskAction} style={{ display: 'inline-flex' }}>
              <input type="hidden" name="task_id" value={task.id} />
              <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">
                {isCompleted ? 'Reopen' : 'Mark complete'}
              </button>
            </form>
          </span>
        }
      />

      {task.description && (
        <Panel title="Description">
          <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{task.description}</div>
        </Panel>
      )}

      {task.recommended_action && (
        <Panel title="Recommended action" eyebrow="Deterministic — from the originating rule">
          <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{task.recommended_action}</div>
        </Panel>
      )}

      {intel && (
        <Panel title="Linked Intelligence item" eyebrow={`${intel.category}${intel.type ? ' · ' + intel.type : ''}${intel.signal_kind ? ' · ' + intel.signal_kind : ''}`}>
          <div style={{ display: 'grid', gap: 6 }}>
            <strong style={{ fontSize: 13 }}>{intel.title}</strong>
            {intel.summary && <span style={{ fontSize: 12.5, color: 'var(--admin-text-muted)' }}>{intel.summary}</span>}
            {intel.recommended_action && (
              <span style={{ fontSize: 12.5 }}>{intel.recommended_action}</span>
            )}
            <StatusBadge state="info" label={`priority ${intel.priority_score ?? '—'}`} />
          </div>
        </Panel>
      )}

      {/* CN-05 OS Phase C — Frozen baseline.
          Pre-change snapshot of GSC + GA4 for this task's site, used
          as the stable reference point for future D7/D14/D28/D90
          measurement. Immutable under normal editing; the Re-freeze
          button is intentionally labelled "force" to discourage use
          after implementation starts. */}
      <Panel
        title="Frozen baseline"
        eyebrow="Pre-change snapshot · 28-day GSC + GA4 window · immutable"
        actions={
          !baseline ? (
            <form action={freezeBaselineAction} style={{ display: 'inline-flex' }}>
              <input type="hidden" name="task_id" value={task.id} />
              <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">
                Freeze baseline now
              </button>
            </form>
          ) : (
            <form action={freezeBaselineAction} style={{ display: 'inline-flex' }}>
              <input type="hidden" name="task_id" value={task.id} />
              <input type="hidden" name="force" value="1" />
              <button
                type="submit"
                className="ui-btn ui-btn--secondary ui-btn--sm"
                title="Overwrite the existing baseline. Only safe before Claude has implemented the change."
              >
                Re-freeze (force)
              </button>
            </form>
          )
        }
      >
        {!baseline ? (
          <Notice tone="info">
            No baseline captured yet. Click <strong>Freeze baseline now</strong> to snapshot the
            latest-complete GSC + GA4 window for this {task.site_id ? 'site' : 'task'}. The
            snapshot is immutable afterwards. Freeze <strong>before</strong> Claude implements so
            future measurement at D7/D14/D28/D90 has a stable reference point. If no GSC/GA4 data
            exists for the site, this is surfaced in the notes — we never invent numbers.
          </Notice>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--admin-text-muted)' }}>
              <span>Frozen: {baseline.frozen_at}</span>
              <span>·</span>
              <span>Window: <code>{baseline.window_start ?? '—'} → {baseline.window_end ?? '—'}</code></span>
              <span>·</span>
              <span>GSC data to: <code>{baseline.data_source_freshness?.gsc ?? '—'}</code></span>
              <span>·</span>
              <span>GA4 data to: <code>{baseline.data_source_freshness?.ga4 ?? '—'}</code></span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, fontSize: 12 }}>
              <BaselineKV label="GSC clicks (28d)" value={baseline.gsc_clicks_28d} />
              <BaselineKV label="GSC impressions (28d)" value={baseline.gsc_impressions_28d} />
              <BaselineKV label="GSC avg CTR" value={baseline.gsc_avg_ctr_28d != null ? `${(baseline.gsc_avg_ctr_28d * 100).toFixed(2)}%` : null} />
              <BaselineKV label="GSC avg position" value={baseline.gsc_avg_position_28d != null ? baseline.gsc_avg_position_28d.toFixed(1) : null} />
              <BaselineKV label="GA4 active users (28d)" value={baseline.ga4_active_users_28d} />
              <BaselineKV label="GA4 sessions (28d)" value={baseline.ga4_sessions_28d} />
            </div>

            {(baseline.target_url || baseline.target_query) && (
              <div style={{ fontSize: 12 }}>
                {baseline.target_url && <div>Target URL: <code>{baseline.target_url}</code></div>}
                {baseline.target_query && <div>Target query: <code>{baseline.target_query}</code></div>}
              </div>
            )}

            {baseline.notes && baseline.notes.length > 0 && (
              <Notice tone="warning">
                <strong>Notes:</strong>
                <ul style={{ margin: '4px 0 0 20px' }}>
                  {baseline.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </Notice>
            )}

            {(baseline.no_gsc_data || baseline.no_ga4_data) && (
              <Notice tone="info">
                Honest data gap:{' '}
                {baseline.no_gsc_data && <>no GSC rows for this site/window. </>}
                {baseline.no_ga4_data && <>no GA4 rows for this site/window. </>}
                Baseline is still frozen — measurement comparisons will carry the same gap.
              </Notice>
            )}
          </div>
        )}
      </Panel>

      <Panel
        title="Claude Code prompt"
        eyebrow="Deterministic · evidence-based · zero AI API spend"
        actions={
          <form action={generateClaudePromptAction} style={{ display: 'inline-flex' }}>
            <input type="hidden" name="task_id" value={task.id} />
            <button
              type="submit"
              className="ui-btn ui-btn--primary ui-btn--sm"
            >
              {latestPrompt ? 'Regenerate prompt' : 'Generate Claude Code prompt'}
            </button>
          </form>
        }
      >
        {!latestPrompt ? (
          <Notice tone="info">
            No prompt generated yet for this action. Clicking <strong>Generate</strong> runs the
            deterministic builder on the server — no AI API calls — and stores the resulting
            prompt in <code>network_tasks.metadata.generated_prompts</code>. The latest prompt
            is shown here; the last 10 are retained for audit.
          </Notice>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--admin-text-muted)' }}>
              <span>Version: <code>{latestPrompt.prompt_version ?? '—'}</code></span>
              <span>·</span>
              <span>Hash: <code title={latestPrompt.prompt_hash ?? ''}>{(latestPrompt.prompt_hash ?? '').slice(0, 12)}…</code></span>
              <span>·</span>
              <span>Classification: <code>{latestPrompt.implementation_type ?? '—'}</code></span>
              <span>·</span>
              <span>Generated: {latestPrompt.created_at ?? '—'}</span>
            </div>
            <textarea
              readOnly
              value={latestPrompt.prompt_text ?? ''}
              style={{
                width: '100%',
                minHeight: 400,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
                lineHeight: 1.5,
                padding: 12,
                border: '1px solid var(--admin-border)',
                borderRadius: 6,
                background: 'var(--admin-bg)',
                color: 'var(--admin-text)',
                resize: 'vertical',
              }}
            />
            <Notice tone="info">
              Copy this prompt and paste it into Claude Code. The completion-report format in the
              prompt tells Claude exactly how to return the implementation receipt. Marking the
              task <strong>complete</strong> is the lightweight receipt channel until the
              dedicated completion-import workflow is wired (see Sprint 10 proposal).
            </Notice>
          </div>
        )}
      </Panel>

      {/* CN-05 OS Phase B — Record Claude Implementation.
          Operator pastes the structured JSON Claude returned after
          finishing the action; we validate strictly and append to
          implementation_receipts. Operator must then confirm the
          production deployment is actually verified — Claude's JSON
          is never a self-certifying receipt. */}
      <Panel
        title="Claude implementation receipt"
        eyebrow="Paste JSON · operator must confirm verification"
      >
        {receiptError && (
          <div style={{ marginBottom: 10 }}>
            <Notice tone="danger">
              <strong>Receipt rejected:</strong> {receiptError.message}
              {receiptError.path && <> <code>({receiptError.path})</code></>}
              <br />
              <span style={{ fontSize: 11, opacity: 0.8 }}>at {receiptError.at}</span>
            </Notice>
          </div>
        )}

        {!latestReceipt ? (
          <form action={recordClaudeImplementationAction} style={{ display: 'grid', gap: 8 }}>
            <input type="hidden" name="task_id" value={task.id} />
            <label style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>
              Paste the completion JSON Claude returned (per the prompt format above).
              Prose before or after the JSON is fine — we extract the first balanced object.
            </label>
            <textarea
              name="receipt"
              required
              placeholder={`{\n  "action_id": "${task.id}",\n  "completed_at": "<ISO timestamp>",\n  "repository": "...",\n  "commit_sha": "...",\n  "production_deployment_sha": "...",\n  "summary_of_what_changed": "...",\n  "live_verification": "..."\n}`}
              style={{
                width: '100%',
                minHeight: 220,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
                lineHeight: 1.5,
                padding: 10,
                border: '1px solid var(--admin-border)',
                borderRadius: 6,
                background: 'var(--admin-bg)',
                color: 'var(--admin-text)',
                resize: 'vertical',
              }}
            />
            <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm" style={{ width: 'fit-content' }}>
              Record Claude implementation
            </button>
          </form>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
              <StatusBadge
                state={operatorVerified ? 'success' : 'warning'}
                label={operatorVerified ? 'Operator verified' : 'Awaiting operator verification'}
              />
              <span style={{ color: 'var(--admin-text-muted)' }}>
                Received {latestReceipt.received_at}
              </span>
              {operatorVerified && (
                <span style={{ color: 'var(--admin-text-muted)' }}>
                  · Confirmed {latestReceipt.operator_confirmed_at}
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
              <div>
                <strong>Summary:</strong> {latestReceipt.summary_of_what_changed}
              </div>
              {latestReceipt.commit_sha && (
                <div><strong>Commit:</strong> <code>{latestReceipt.commit_sha}</code></div>
              )}
              {latestReceipt.production_deployment_sha && (
                <div><strong>Prod SHA:</strong> <code>{latestReceipt.production_deployment_sha}</code></div>
              )}
              {latestReceipt.live_verification && (
                <div><strong>Live verification:</strong> {latestReceipt.live_verification}</div>
              )}
              {latestReceipt.rollback_route && (
                <div><strong>Rollback:</strong> <code>{latestReceipt.rollback_route}</code></div>
              )}
              {latestReceipt.outstanding_issues && (
                <div><strong>Outstanding:</strong> {latestReceipt.outstanding_issues}</div>
              )}
            </div>

            {!operatorVerified && (
              <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                <form action={confirmReceiptVerifiedAction}>
                  <input type="hidden" name="task_id" value={task.id} />
                  <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">
                    I verified production — confirm receipt
                  </button>
                </form>
                <span style={{ fontSize: 11.5, color: 'var(--admin-text-muted)' }}>
                  Claude&apos;s JSON claim is never a self-certifying receipt. Verify the Vercel
                  prod SHA + the live site before clicking.
                </span>
              </div>
            )}

            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--admin-text-muted)' }}>
                Raw receipt + history ({receipts.length})
              </summary>
              <pre style={{ fontSize: 11, lineHeight: 1.5, overflowX: 'auto', background: 'var(--admin-bg)', padding: 10, borderRadius: 6, border: '1px solid var(--admin-border)' }}>
{JSON.stringify(receipts, null, 2)}
              </pre>
            </details>

            <form action={recordClaudeImplementationAction} style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              <input type="hidden" name="task_id" value={task.id} />
              <label style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>
                Paste a new receipt to supersede (Claude re-did the work, or an initial receipt had wrong SHA):
              </label>
              <textarea
                name="receipt"
                placeholder="Paste a replacement JSON receipt here"
                style={{
                  width: '100%',
                  minHeight: 140,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  lineHeight: 1.5,
                  padding: 10,
                  border: '1px solid var(--admin-border)',
                  borderRadius: 6,
                  background: 'var(--admin-bg)',
                  color: 'var(--admin-text)',
                  resize: 'vertical',
                }}
              />
              <button type="submit" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ width: 'fit-content' }}>
                Append new receipt
              </button>
            </form>
          </div>
        )}
      </Panel>

      {/* CN-05 OS — Measurement panel.
          Visible only once a measurement schedule exists (set when
          the operator verifies an implementation receipt). The
          baseline above is the reference; checkpoints here are the
          observed post-change windows. Nothing displayed here is a
          causal claim — the Notice at the bottom spells that out. */}
      {schedule && (
        <Panel
          title="Measurement"
          eyebrow={`Anchored ${schedule.anchor_at.slice(0, 10)} · ${measurementState.replace(/_/g, ' ')}`}
        >
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>
              Primary success metric: <code>{schedule.primary_success_metric ?? '— (defaults to GSC clicks)'}</code>
              {schedule.anchor_receipt_deployment_sha && <> · prod SHA: <code>{schedule.anchor_receipt_deployment_sha.slice(0, 12)}</code></>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              {CHECKPOINTS.map((d) => {
                const key = `D${d}` as const;
                const target = schedule.target_dates[key];
                const captured = checkpoints.find((c) => c.checkpoint === d) ?? null;
                return <CheckpointCard key={d} dCount={d} targetDate={target} captured={captured} />;
              })}
            </div>

            {checkpoints.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>
                Summary: <code>{summariseOutcome(checkpoints)}</code>
              </div>
            )}

            <Notice tone="info">
              Observed change only. The baseline is a 28-day reference window; checkpoint windows
              are matched pre/post lengths (7/14/28/90 days). Correlation is not causation —
              unrelated deploys, algorithm updates, or seasonality can move numbers in either
              direction. Record interpretation on the task; the OS will not infer causation.
            </Notice>

            <details>
              <summary style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--admin-text-muted)' }}>
                Raw measurement data ({checkpoints.length} checkpoint entries)
              </summary>
              <pre style={{ fontSize: 11, lineHeight: 1.5, overflowX: 'auto', background: 'var(--admin-bg)', padding: 10, borderRadius: 6, border: '1px solid var(--admin-border)' }}>
{JSON.stringify(checkpoints, null, 2)}
              </pre>
            </details>
          </div>
        </Panel>
      )}

      {!schedule && operatorVerified && (
        <Panel title="Measurement" eyebrow="Scheduling…">
          <Notice tone="info">
            A measurement schedule will land on the next cron tick. If you expected it to be
            visible now, confirm the implementation receipt was pasted BEFORE operator
            verification — the schedule is written on verify, anchored to the receipt&apos;s
            completed_at timestamp.
          </Notice>
        </Panel>
      )}

      <Panel title="Metadata" eyebrow="Audit · raw task + evidence">
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--admin-text-muted)' }}>Show raw task evidence + metadata</summary>
          <pre style={{ fontSize: 11, lineHeight: 1.5, overflowX: 'auto', background: 'var(--admin-bg)', padding: 10, borderRadius: 6, border: '1px solid var(--admin-border)' }}>
{JSON.stringify({ evidence: task.evidence, metadata: task.metadata, created_at: task.created_at, completed_at: task.completed_at }, null, 2)}
          </pre>
        </details>
      </Panel>
    </AdminShell>
  );
}

function CheckpointCard({ dCount, targetDate, captured }: { dCount: 7 | 14 | 28 | 90; targetDate: string; captured: Checkpoint | null }) {
  const today = new Date().toISOString().slice(0, 10);
  const dueDate = addDays(targetDate, SETTLE_LAG_DAYS);
  const stateLabel = (() => {
    if (!captured) return today >= dueDate ? 'awaiting cron' : 'pending';
    return captured.outcome.replace(/_/g, ' ');
  })();
  const tone: 'default' | 'green' | 'amber' | 'red' = (() => {
    if (!captured || captured.status === 'pending') return 'default';
    if (captured.outcome === 'observed_improvement') return 'green';
    if (captured.outcome === 'observed_decline') return 'red';
    return 'amber';
  })();
  const toneBorder = tone === 'green' ? '#1d8a4b' : tone === 'red' ? '#c43f3f' : tone === 'amber' ? '#b58b1a' : 'var(--admin-border)';
  const toneBg = tone === 'green' ? 'rgba(29,138,75,0.08)' : tone === 'red' ? 'rgba(196,63,63,0.07)' : tone === 'amber' ? 'rgba(181,139,26,0.08)' : 'var(--admin-bg)';
  return (
    <div style={{ padding: 10, border: `1px solid ${toneBorder}`, borderRadius: 6, background: toneBg, display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 14 }}>D{dCount}</strong>
        <span style={{ fontSize: 10.5, color: 'var(--admin-text-muted)' }}>target {targetDate}</span>
      </div>
      <div style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3 }}>{stateLabel}</div>
      {captured && captured.primary && (
        <div style={{ fontSize: 12 }}>
          <code>{captured.primary.metric}</code>:{' '}
          {captured.primary.pair.pre == null || captured.primary.pair.post == null ? (
            <span style={{ color: 'var(--admin-text-muted)' }}>—</span>
          ) : (
            <>
              <code>{fmtNum(captured.primary.pair.pre)}</code> → <code>{fmtNum(captured.primary.pair.post)}</code>
              {captured.primary.pair.delta_pct != null && (
                <span style={{ marginLeft: 6, fontWeight: 600 }}>
                  {captured.primary.pair.delta_pct > 0 ? '+' : ''}{captured.primary.pair.delta_pct.toFixed(1)}%
                </span>
              )}
            </>
          )}
        </div>
      )}
      {captured && captured.pre_window && captured.post_window && (
        <div style={{ fontSize: 10.5, color: 'var(--admin-text-muted)' }}>
          pre <code>{captured.pre_window.start}→{captured.pre_window.end}</code> · post <code>{captured.post_window.start}→{captured.post_window.end}</code>
        </div>
      )}
      {captured && captured.gsc_site && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 10.5, color: 'var(--admin-text-muted)' }}>GSC + GA4 detail</summary>
          <div style={{ fontSize: 11, marginTop: 4 }}>
            <MeasureRow label="GSC clicks" pair={captured.gsc_site.clicks} />
            <MeasureRow label="GSC impressions" pair={captured.gsc_site.impressions} />
            <MeasureRow label="GSC CTR" pair={captured.gsc_site.ctr} isPct />
            <MeasureRow label="GSC avg position" pair={captured.gsc_site.avg_position} isPosition />
            {captured.ga4_site && <MeasureRow label="GA4 active users" pair={captured.ga4_site.active_users} />}
            {captured.ga4_site && <MeasureRow label="GA4 sessions" pair={captured.ga4_site.sessions} />}
          </div>
        </details>
      )}
    </div>
  );
}

function MeasureRow({ label, pair, isPct, isPosition }: { label: string; pair: { pre: number | null; post: number | null; delta_pct: number | null }; isPct?: boolean; isPosition?: boolean }) {
  const fmt = (v: number | null) => v == null ? '—' : isPct ? `${(v * 100).toFixed(2)}%` : isPosition ? v.toFixed(1) : v.toLocaleString();
  return (
    <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
      <span style={{ color: 'var(--admin-text-muted)', width: 130 }}>{label}:</span>
      <span><code>{fmt(pair.pre)}</code> → <code>{fmt(pair.post)}</code></span>
      {pair.delta_pct != null && <span style={{ marginLeft: 'auto' }}>{pair.delta_pct > 0 ? '+' : ''}{pair.delta_pct.toFixed(1)}%</span>}
    </div>
  );
}

function fmtNum(v: number): string {
  if (Math.abs(v) < 1 && v !== 0) return v.toFixed(3);
  return v.toLocaleString();
}

function BaselineKV({ label, value }: { label: string; value: number | string | null }) {
  const display = value == null
    ? <span style={{ color: 'var(--admin-text-muted)' }}>—</span>
    : typeof value === 'number'
      ? value.toLocaleString()
      : value;
  return (
    <div style={{ padding: '6px 8px', border: '1px solid var(--admin-border)', borderRadius: 6, background: 'var(--admin-bg)' }}>
      <div style={{ fontSize: 10.5, color: 'var(--admin-text-muted)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{display}</div>
    </div>
  );
}
