import 'server-only';
import { createHash } from 'node:crypto';

// CN-05 OS Phase 2 — deterministic Claude Code prompt builder.
//
// Takes a network_tasks row (and its evidence payload from the linked
// network_intelligence_items row if the task was sourced from the
// Intelligence engine) and assembles a structured implementation
// prompt. Pure function — same inputs produce the same prompt text
// and the same sha256 hash, every time, with no AI API spend.
//
// Prompts are intentionally READ-ONLY artefacts: they are generated
// on demand, saved into network_tasks.metadata.generated_prompts
// for audit, and offered to the operator to copy and paste into
// Claude Code. Generation does NOT execute the action.

export const PROMPT_VERSION = 'cn05-action-prompt-v1';

export interface TaskForPrompt {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  site_id: string | null;
  task_type: string;
  task_kind: 'fix' | 'improvement';
  task_source: string;
  evidence: Record<string, unknown>;
  metadata: Record<string, unknown>;
  recommended_action?: string | null;
  created_at: string;
}

export interface SiteForPrompt {
  slug: string | null;
  name: string | null;
  domain: string | null;
}

export interface IntelligenceForPrompt {
  id: string;
  category: string;
  type: string | null;
  signal_kind: string | null;
  title: string;
  summary: string | null;
  recommended_action: string | null;
  evidence: Record<string, unknown>;
  expected_upside: Record<string, unknown> | null;
  impact_score: number | null;
  confidence_score: number | null;
  urgency_score: number | null;
  effort_score: number | null;
  priority_score: number | null;
  first_detected_at: string | null;
  last_detected_at: string | null;
}

/** Classification of what Claude is expected to do with this action.
 *  Drives the "Required checks and tests" + "Deployment verification"
 *  sections of the generated prompt. Pure heuristic over task_type +
 *  category — no model call. */
export type ActionImplementationType =
  | 'code_change'              // requires a commit + Vercel deploy
  | 'content_edit'             // Articles / editorial via admin UI, not a repo commit
  | 'manual_platform_action'   // operator must action in GSC / Vercel / Impact UI
  | 'commercial_outreach'      // partner CRM, email, call — not a code change
  | 'data_quality_fix'         // DB-side query or Server Action, no public UI
  | 'investigation'            // read-only diagnostic, no production change

export function classifyAction(
  task: Pick<TaskForPrompt, 'task_type' | 'task_kind'>,
  intel: Pick<IntelligenceForPrompt, 'category'> | null,
): ActionImplementationType {
  const t = (task.task_type ?? '').toLowerCase();
  const c = (intel?.category ?? '').toLowerCase();
  if (t === 'commercial' || c === 'revenue' || c === 'monetisation') return 'commercial_outreach';
  if (t === 'content' || c === 'content') return 'content_edit';
  if (t === 'indexing' || c === 'indexing') return 'manual_platform_action';
  if (t === 'investigation' || c === 'data_health') return 'investigation';
  if (c === 'technical' || t === 'technical') return 'code_change';
  if (c === 'seo') return 'code_change';
  return 'code_change';
}

/** Resolve the hub repo + app directory for a given site slug.
 *  Deterministic lookup; the three network-wide repos live in known
 *  paths. Returns null for Network-scoped tasks. */
export function repoHintForSite(slug: string | null): { repo: string; app: string } | null {
  switch ((slug ?? '').toLowerCase()) {
    case 'pokemon':   return { repo: 'pokeprices-web (separate GitHub repo)', app: 'root' };
    case 'mtg':       return { repo: 'mtgprices-web (separate GitHub repo)', app: 'root' };
    case 'ygo':       return { repo: 'collector-network', app: 'apps/yugioh' };
    case 'onepiece':  return { repo: 'collector-network', app: 'apps/onepiece' };
    case 'lorcana':   return { repo: 'collector-network', app: 'apps/lorcana' };
    default:          return null;
  }
}

export interface BaselineForPrompt {
  frozen_at: string;
  window_start: string | null;
  window_end: string | null;
  target_url: string | null;
  target_query: string | null;
  gsc_clicks_28d: number | null;
  gsc_impressions_28d: number | null;
  gsc_avg_position_28d: number | null;
  gsc_avg_ctr_28d: number | null;
  ga4_active_users_28d: number | null;
  ga4_sessions_28d: number | null;
  notes?: string[];
}

export interface BuildPromptInput {
  task: TaskForPrompt;
  site: SiteForPrompt | null;
  intel: IntelligenceForPrompt | null;
  /** CN-05 OS Phase C — frozen pre-change snapshot. When present we
   *  surface it in a dedicated Baseline section so Claude can quote
   *  exact pre-change numbers in the completion receipt. Null when
   *  no baseline has been frozen yet. */
  baseline?: BaselineForPrompt | null;
}

export interface BuiltPrompt {
  prompt_text: string;
  prompt_hash: string;
  prompt_version: string;
  implementation_type: ActionImplementationType;
  created_at: string;
}

/** Build the full prompt text + hash. No side effects. */
export function buildClaudePrompt(input: BuildPromptInput): BuiltPrompt {
  const { task, site, intel, baseline } = input;
  const implType = classifyAction(task, intel);
  const repoHint = repoHintForSite(site?.slug ?? null);

  const sections: string[] = [];

  // 1. Action header
  sections.push(`# CN-05 Action: ${task.title}`);
  sections.push(`**Action ID:** \`${task.id}\``);
  sections.push(`**Site:** ${site?.name ?? 'Network'} (${site?.slug ?? 'network'})${site?.domain ? ` — https://${site.domain}` : ''}`);
  sections.push(`**Priority:** ${task.priority}`);
  sections.push(`**Kind:** ${task.task_kind} · ${task.task_type}`);
  sections.push(`**Classification:** \`${implType}\``);
  if (intel) {
    sections.push(`**Opportunity category:** ${intel.category}${intel.type ? ` · ${intel.type}` : ''}`);
    sections.push(`**Signal kind:** ${intel.signal_kind ?? 'opportunity'}`);
  }

  // 2. Background
  sections.push('\n## Background');
  if (intel?.summary) sections.push(intel.summary);
  if (task.description) sections.push(task.description);
  if (intel?.first_detected_at) {
    sections.push(`\n**Detected:** ${intel.first_detected_at} · **Last seen:** ${intel.last_detected_at ?? intel.first_detected_at}`);
  }

  // 3. Supporting evidence (deterministic JSON pretty-print)
  const evidencePayload = {
    task_evidence: task.evidence ?? {},
    intel_evidence: intel?.evidence ?? null,
    expected_upside: intel?.expected_upside ?? null,
  };
  sections.push('\n## Supporting evidence');
  sections.push('```json');
  sections.push(JSON.stringify(evidencePayload, null, 2));
  sections.push('```');

  // 4. Scoring
  if (intel) {
    sections.push('\n## Prioritisation scores (0–100)');
    sections.push([
      `impact=${intel.impact_score ?? '—'}`,
      `confidence=${intel.confidence_score ?? '—'}`,
      `urgency=${intel.urgency_score ?? '—'}`,
      `effort=${intel.effort_score ?? '—'}`,
      `priority=${intel.priority_score ?? '—'}`,
    ].join(' · '));
    sections.push(
      '`confidence` reflects how certain the detection rule is that this is a real opportunity. ' +
      'Treat anything below 60 as a hypothesis, not a confirmed fact.',
    );
  }

  // 5. Recommended action
  sections.push('\n## Recommended action');
  sections.push(intel?.recommended_action ?? task.recommended_action ?? 'Not specified — see Background.');

  // 6. Classification-specific implementation guidance
  sections.push('\n## Implementation instructions');
  switch (implType) {
    case 'code_change':
      sections.push([
        `Repository: **${repoHint?.repo ?? 'identify from site'}**` + (repoHint?.app && repoHint.app !== 'root' ? ` (${repoHint.app}/)` : ''),
        '',
        'Steps:',
        '1. Read the relevant files identified in the evidence. Do not assume file paths; grep for the target.',
        '2. Make the minimum change needed to achieve the recommended action. Preserve existing tests.',
        '3. Run the local typecheck and `next build` for the affected app before committing.',
        '4. Commit with the CN-05 action ID in the trailer so this receipt links back automatically.',
        '5. Push to origin/main and wait for Vercel to confirm READY state on the correct project.',
        '6. Verify the live production URL (not just the Git HEAD).',
      ].join('\n'));
      break;
    case 'content_edit':
      sections.push([
        'This is an editorial change, not a code change. Use the OS Articles admin:',
        '1. Open `/admin/content/articles` on the hub.',
        '2. Create or locate the draft for the affected site.',
        '3. Make the content change in the TipTap editor.',
        '4. Save, then flip status → review for human sign-off.',
        '5. Do NOT publish or schedule — human approval is required.',
      ].join('\n'));
      break;
    case 'manual_platform_action':
      sections.push([
        'This action requires manual access to a third-party dashboard that Claude Code cannot drive:',
        '',
        '- Google Search Console: URL Inspection + Request Indexing',
        '- Bing Webmaster Tools: Submit URL',
        '- Vercel: domain configuration, environment variables',
        '- Impact: shared ID reporting review',
        '',
        'Do not attempt to automate this. Record what you performed and the result via the completion receipt.',
      ].join('\n'));
      break;
    case 'commercial_outreach':
      sections.push([
        'This is a commercial / outreach action, not a code change. Use the admin partners CRM:',
        '1. Open `/admin/partners`.',
        '2. Open the referenced partner / sponsorship / opportunity row.',
        '3. Perform the outreach step described in Recommended Action.',
        '4. Log the activity in the CRM (contact log, next-step date).',
      ].join('\n'));
      break;
    case 'data_quality_fix':
      sections.push([
        'This is a server-side data fix. Prefer idempotent, bounded SQL.',
        '1. Scope the fix with a bounded SELECT before any UPDATE.',
        '2. Use advisory locks / idempotency keys where supported.',
        '3. Do not run unbounded full-table operations.',
        '4. Verify by reading the fixed rows post-change.',
      ].join('\n'));
      break;
    case 'investigation':
      sections.push([
        'This is a read-only investigation.',
        '1. Produce a one-page summary of findings with evidence citations.',
        '2. Do not make production changes.',
        '3. Submit the summary as the completion receipt.',
      ].join('\n'));
      break;
  }

  // 6b. CN-05 OS Phase C — frozen baseline (pre-change snapshot).
  //      Only surfaces when the operator has frozen one; null baselines
  //      remain in the hash input as null so this section is stable.
  if (baseline) {
    sections.push('\n## Frozen baseline (pre-change snapshot)');
    sections.push(`Frozen at ${baseline.frozen_at}. Window: ${baseline.window_start ?? '—'} → ${baseline.window_end ?? '—'}.`);
    if (baseline.target_url) sections.push(`Target URL: \`${baseline.target_url}\``);
    if (baseline.target_query) sections.push(`Target query: \`${baseline.target_query}\``);
    sections.push('```json');
    sections.push(JSON.stringify({
      window: { start: baseline.window_start, end: baseline.window_end },
      gsc_clicks_28d: baseline.gsc_clicks_28d,
      gsc_impressions_28d: baseline.gsc_impressions_28d,
      gsc_avg_ctr_28d: baseline.gsc_avg_ctr_28d,
      gsc_avg_position_28d: baseline.gsc_avg_position_28d,
      ga4_active_users_28d: baseline.ga4_active_users_28d,
      ga4_sessions_28d: baseline.ga4_sessions_28d,
    }, null, 2));
    sections.push('```');
    if (baseline.notes && baseline.notes.length > 0) {
      sections.push('\n**Baseline notes:**');
      for (const n of baseline.notes) sections.push(`- ${n}`);
    }
    sections.push(
      '\nQuote these exact numbers in your completion receipt so the OS can line them up ' +
      'against the post-change window. Do not re-compute the baseline — it is frozen.',
    );
  }

  // 7. Expected outcome + measurement
  sections.push('\n## Expected measurable outcome');
  const upsidePresent = intel?.expected_upside && Object.keys(intel.expected_upside).length > 0;
  if (upsidePresent) {
    sections.push('```json');
    sections.push(JSON.stringify(intel!.expected_upside, null, 2));
    sections.push('```');
  } else {
    sections.push(
      'No pre-computed upside estimate on the Intelligence row. Record your post-change ' +
      'expectation (one primary success metric + at least one guardrail metric) in the completion ' +
      'receipt so the OS can measure it at D7/D14/D28/D90.',
    );
  }
  sections.push(
    '\n**Measurement windows:** D7, D14, D28, D90 relative to the deployment date. The OS reads ' +
    'GSC + GA4 daily tables (3-day settle lag for both). Base all comparisons on complete reporting ' +
    'periods — never partial-day numbers.',
  );

  // 8. Constraints & risks
  sections.push('\n## Constraints and risks');
  sections.push([
    '- Preserve existing production functionality. Protect PokePrices SEO recovery.',
    '- Small, independent, reversible commits. Rollback = single `git revert`.',
    '- No DB migrations unless specifically justified by this action\'s evidence.',
    '- No region / sitemap / robots / canonical changes unless the action explicitly asks for them.',
    '- No new paid AI dependencies.',
    '- No scraping of TCGplayer or other partner surfaces.',
    '- Do NOT mark the action complete merely because a commit was pushed — the completion receipt must include a Vercel READY state for the correct project.',
  ].join('\n'));

  // 9. Completion-report format
  sections.push('\n## Completion-report format');
  sections.push(
    'When you have finished, return a JSON block with these fields (plus a short prose summary):'
  );
  sections.push('```json');
  sections.push(JSON.stringify({
    action_id: task.id,
    implementation_type: implType,
    completed_at: '<ISO timestamp>',
    repository: repoHint?.repo ?? '<repo>',
    commit_sha: '<sha or N/A>',
    production_deployment_sha: '<Vercel prod SHA or N/A>',
    affected_pages_or_features: ['<list>'],
    summary_of_what_changed: '<prose>',
    tests_performed: ['<list>'],
    live_verification: '<url + observed behaviour>',
    rollback_route: '<single git revert sha, dashboard step, etc.>',
    primary_success_metric: '<e.g. gsc_clicks_28d_delta>',
    guardrail_metrics: ['<list>'],
    outstanding_issues: '<prose or null>',
  }, null, 2));
  sections.push('```');

  sections.push(
    '\nPaste this JSON (plus any prose context) back into the Action detail screen on the OS to close ' +
    'the loop. The OS will freeze a baseline for the primary metric and start the D7/D14/D28/D90 ' +
    'measurement cycle.',
  );

  const prompt_text = sections.join('\n');
  // Hash is over the semantic input, NOT the formatted text, so a comment
  // tweak to buildClaudePrompt doesn't invalidate historical hashes.
  const hashInput = JSON.stringify({
    v: PROMPT_VERSION,
    task_id: task.id,
    task_evidence: task.evidence,
    intel_id: intel?.id ?? null,
    intel_evidence: intel?.evidence ?? null,
    expected_upside: intel?.expected_upside ?? null,
    recommended_action: intel?.recommended_action ?? task.recommended_action ?? null,
    priority: task.priority,
    task_kind: task.task_kind,
    task_type: task.task_type,
    site_slug: site?.slug ?? null,
    baseline_frozen_at: baseline?.frozen_at ?? null,
  });
  const prompt_hash = createHash('sha256').update(hashInput).digest('hex');

  return {
    prompt_text,
    prompt_hash,
    prompt_version: PROMPT_VERSION,
    implementation_type: implType,
    created_at: new Date().toISOString(),
  };
}
