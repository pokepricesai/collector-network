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
} from './actions';
import { completeTaskAction, reopenTaskAction } from '../actions';
import type { ImplementationReceiptStored } from '@/server/claude/completion-receipt';

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
  };
  const prompts = meta.generated_prompts ?? [];
  const latestPrompt = prompts[0];
  const receipts = meta.implementation_receipts ?? [];
  const latestReceipt = receipts[0];
  const receiptError = meta.receipt_last_error;
  const operatorVerified = latestReceipt?.operator_confirmed_at != null;

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
