import 'server-only';
import { createHash } from 'node:crypto';
import { assessRelevance, type OpportunityType, type RelevanceAssessment } from './relevance';

// CN-05 OS — deterministic Claude Code prompt builder (v2).
//
// Takes a network_tasks row (and its evidence payload from the linked
// network_intelligence_items row if the task was sourced from the
// Intelligence engine) and assembles a structured implementation
// prompt. Pure function — same inputs produce the same prompt text
// and the same sha256 hash, every time, with no AI API spend.
//
// v2 upgrade:
//   * Investigation-first — Claude must INVESTIGATE → DECIDE →
//     EXECUTE → REPORT, with NO_CHANGE as a legitimate outcome.
//   * Opportunity-type-specific investigation checklists (striking
//     distance SEO, indexing, affiliate, content gap, site-wide
//     technical, commercial outreach, generic SEO).
//   * Deterministic relevance assessment surfaced in the prompt so
//     Claude knows about expired-event / stale / thin-signal
//     patterns before reading a single file.
//   * Target-level evidence (impressions / clicks / position for the
//     actual URL + queries) is separated from site-wide baseline so
//     site-wide movement can't masquerade as a page-level outcome.
//   * No duplicated background paragraph. No overlapping evidence
//     dump.
//
// Prompts are READ-ONLY artefacts: generated on demand, saved into
// network_tasks.metadata.generated_prompts for audit, offered to the
// operator to copy and paste into Claude Code. Generation does NOT
// execute the action.

export const PROMPT_VERSION = 'cn05-action-prompt-v2';

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

/** Target-URL / target-query level GSC metrics loaded from
 *  network_gsc_url_daily or network_gsc_query_daily by the caller.
 *  Pure consumer here — the builder stays sync. */
export interface TargetEvidenceForPrompt {
  target_url: string | null;
  target_query: string | null;
  window: { start: string; end: string } | null;
  url_level: {
    impressions_28d: number;
    clicks_28d: number;
    ctr_28d: number | null;
    avg_position_28d: number | null;
    days_with_data: number;
  } | null;
  query_level: {
    impressions_28d: number;
    clicks_28d: number;
    ctr_28d: number | null;
    avg_position_28d: number | null;
    days_with_data: number;
  } | null;
  top_queries_for_url: Array<{ query: string; impressions: number; clicks: number; avg_position: number | null }> | null;
  notes: string[];
}

export interface BuildPromptInput {
  task: TaskForPrompt;
  site: SiteForPrompt | null;
  intel: IntelligenceForPrompt | null;
  baseline?: BaselineForPrompt | null;
  target_evidence?: TargetEvidenceForPrompt | null;
  /** Injectable "today" for deterministic tests. Not used in hash. */
  now?: Date;
}

export interface BuiltPrompt {
  prompt_text: string;
  prompt_hash: string;
  prompt_version: string;
  implementation_type: ActionImplementationType;
  relevance: RelevanceAssessment;
  created_at: string;
}

/** Choose investigation checklist by opportunity type. Returned
 *  array is rendered as a numbered list in Stage A. Keep each item
 *  concrete, pointing to a file/path/concept Claude can act on. */
function investigationChecklist(oppType: OpportunityType, repoLabel: string): string[] {
  const common = (): string[] => [
    `Locate the correct repository and source files. Target repo for this site: **${repoLabel}**. Grep for the target URL path; do not assume file paths.`,
    'Open the current production URL in your head: what does the page look like today? Pull the live HTML (curl, fetch, or production browse) and read the current `<title>`, `<meta name="description">`, canonical, `<h1>`, and the first screen of visible content.',
    'Compare the live page against the Intelligence evidence below. Does the issue described still show up?',
    'Determine the blast radius: is the target rendered by a single page component, a shared template, or network-wide shell? Identify which other pages would be affected by any change you make.',
  ];
  switch (oppType) {
    case 'striking_distance_seo':
      return [
        ...common(),
        'Match the ranking queries (below) against the current `<title>`, meta description, and `<h1>`. Are the user-intent tokens present or missing?',
        'Decide whether a title/meta rewrite is actually warranted. A page already carrying the primary query in both title and H1 is NOT a striking-distance fix — it may need content or internal-link reinforcement instead.',
        'If you draft a rewrite, keep it specific to this URL. Do NOT edit any shared template, meta-generator helper, or `generateMetadata` function in a way that would propagate across unrelated pages.',
      ];
    case 'indexing_issue':
      return [
        ...common(),
        'Pull the production response: status code, response size, canonical header, `<meta name="robots">`, `<link rel="canonical">`.',
        'Check sitemap presence: does the URL appear in the site\'s sitemap shard? Is it `<url>` or excluded? Inspect `apps/<site>/src/app/sitemap-*.xml/route.ts` or the per-site sitemap generator.',
        'Check robots.txt for the host and verify it does not disallow the path.',
        'If GSC URL Inspection coverage data is available in `network_url_inspection`, read it — do not make a change for a URL Google already reports as "Indexed".',
      ];
    case 'affiliate_conversion':
      return [
        ...common(),
        'Inspect the current affiliate placement on the target page: anchor text, placement, merchant mapping, outbound tracking (irpid, sharedid), rel attributes.',
        'Check `network_affiliate_clicks` / Impact ingest tables for the current click volume + CVR for this page. Do NOT propose "add another button" if existing clicks are already producing conversions.',
        'If you change placements, do not touch the Impact Media Partner API attribution helpers. Those are shared and a mistake is network-wide.',
      ];
    case 'content_gap':
      return [
        ...common(),
        'Check whether the OS Articles pipeline already has an idea/brief/draft covering this topic. See `/admin/content/ideas`, `/admin/content/briefs`, `/admin/content/articles`. Do not duplicate work the editorial pipeline is already queuing.',
        'If genuine new content is needed, route the operator through the existing Writing Brief workflow (approved idea → brief → paste draft). Do NOT publish content directly from this prompt.',
        'Preserve the $1 / 7-day AI budget — this prompt itself is deterministic and must stay that way.',
      ];
    case 'site_wide_technical':
      return [
        ...common(),
        'Pull the deployment history for the affected app from Vercel (`list_deployments`) — align the detection window with any recent deploys that could be the actual cause.',
        'Check whether this is a site-wide trend affecting many URLs, not an isolated page bug. If so, treat it as a technical investigation first — do not apply single-page SEO instructions.',
        'If a shared template, middleware, next.config, or sitemap generator is the suspected root, propose a repository-wide fix with regression scope documented.',
      ];
    case 'commercial_outreach':
      return [
        'This is a commercial / outreach action, not a code change. Use the admin partners CRM at `/admin/partners`.',
        'Open the referenced partner / sponsorship / opportunity row.',
        'Read the current contact log + prior outreach history before composing a new message.',
        'Perform the outreach step described in Recommended Action. Log the activity (contact log entry + next-step date).',
      ];
    default:
      return [
        ...common(),
        'The opportunity type is generic / unclassified. Lean heavily on the Investigate stage before considering a change — ambiguous recommendations deserve ambiguous verdicts.',
      ];
  }
}

/** Build the full prompt text + hash. No side effects. */
export function buildClaudePrompt(input: BuildPromptInput): BuiltPrompt {
  const { task, site, intel, baseline, target_evidence } = input;
  const implType = classifyAction(task, intel);
  const repoHint = repoHintForSite(site?.slug ?? null);
  const relevance = assessRelevance({
    task: { task_type: task.task_type, task_kind: task.task_kind, evidence: task.evidence },
    intel: intel ? {
      category: intel.category,
      type: intel.type,
      recommended_action: intel.recommended_action,
      evidence: intel.evidence,
      confidence_score: intel.confidence_score,
      priority_score: intel.priority_score,
      last_detected_at: intel.last_detected_at,
    } : null,
    today: input.now,
  });
  const repoLabel = repoHint?.repo + (repoHint?.app && repoHint.app !== 'root' ? ` (${repoHint.app}/)` : '') || 'identify from site';
  const targetUrl = relevance.signals.target_url ?? baseline?.target_url ?? null;
  const targetQuery = relevance.signals.target_query ?? baseline?.target_query ?? null;

  const sections: string[] = [];

  // ──────────── 1. Header + target identity ────────────
  sections.push(`# CN-05 Action: ${task.title}`);
  sections.push([
    `**Action ID:** \`${task.id}\``,
    `**Site:** ${site?.name ?? 'Network'} (${site?.slug ?? 'network'})${site?.domain ? ` — https://${site.domain}` : ''}`,
    `**Repository:** ${repoLabel}`,
    `**Priority:** ${task.priority}`,
    `**Classification:** \`${implType}\` · **Opportunity type:** \`${relevance.opportunity_type}\``,
  ].join('\n'));
  if (targetUrl) sections.push(`**Target URL:** \`${targetUrl}\``);
  if (targetQuery) sections.push(`**Target query:** \`${targetQuery}\``);
  if (!targetUrl && !targetQuery) sections.push('**Scope:** site-wide — no specific target URL/query carried in the evidence.');

  // ──────────── 2. Detected issue (ONCE, no duplicates) ────────────
  sections.push('\n## Detected issue');
  const recommendation = intel?.recommended_action ?? task.recommended_action ?? 'Not specified — see evidence below.';
  if (intel?.summary) sections.push(intel.summary);
  sections.push(`\n**Recommended action (from detection rule):** ${recommendation}`);
  if (intel?.first_detected_at) {
    const detected = intel.first_detected_at.slice(0, 10);
    const lastSeen = (intel.last_detected_at ?? intel.first_detected_at).slice(0, 10);
    sections.push(`**First detected:** ${detected} · **Last seen:** ${lastSeen}`);
  }

  // ──────────── 3. OS relevance assessment ────────────
  sections.push('\n## OS relevance assessment');
  sections.push(`**Verdict:** \`${relevance.verdict}\``);
  for (const r of relevance.reasons) sections.push(`- ${r}`);
  if (relevance.signals.event_date_hint?.is_in_past) {
    sections.push(`\n> ⚠ Event date detected: **${relevance.signals.event_date_hint.month_year}** — this is in the past. If this is an event, trade show, or time-bound page, the correct outcome is likely NO CHANGE / archive. Verify event dates against the page itself before any rewrite.`);
  }
  if (relevance.verdict === 'insufficient_evidence' || relevance.verdict === 'potentially_stale' || relevance.verdict === 'not_actionable') {
    sections.push('\n> This assessment is a prior, not a verdict. Your investigation can confirm or refute it. If the OS flags "potentially_stale" but your investigation shows the page is still live and ranking, proceed; if the OS flags "actionable" but your inspection reveals a template-level change is required, step back and request approval.');
  }

  // ──────────── 4. Target-level evidence (page/query specific) ────────────
  sections.push('\n## Target-level evidence');
  if (!targetUrl && !targetQuery) {
    sections.push('_No URL or query carried in the frozen baseline — this is a site-wide action. Skip to Site-wide baseline below._');
  } else {
    const te = target_evidence ?? null;
    const compact: Record<string, unknown> = {
      target_url: targetUrl, target_query: targetQuery,
    };
    if (relevance.signals.impressions_28d != null) compact['detection_impressions_28d'] = relevance.signals.impressions_28d;
    if (relevance.signals.clicks_28d != null) compact['detection_clicks_28d'] = relevance.signals.clicks_28d;
    if (relevance.signals.weighted_position != null) compact['detection_weighted_position'] = Number(relevance.signals.weighted_position.toFixed(2));
    if (te?.url_level) {
      compact['url_level_28d'] = {
        clicks: te.url_level.clicks_28d,
        impressions: te.url_level.impressions_28d,
        ctr: te.url_level.ctr_28d != null ? Number((te.url_level.ctr_28d * 100).toFixed(2)) + '%' : null,
        avg_position: te.url_level.avg_position_28d != null ? Number(te.url_level.avg_position_28d.toFixed(2)) : null,
        days_with_data: te.url_level.days_with_data,
      };
    }
    if (te?.query_level) {
      compact['query_level_28d'] = {
        clicks: te.query_level.clicks_28d,
        impressions: te.query_level.impressions_28d,
        ctr: te.query_level.ctr_28d != null ? Number((te.query_level.ctr_28d * 100).toFixed(2)) + '%' : null,
        avg_position: te.query_level.avg_position_28d != null ? Number(te.query_level.avg_position_28d.toFixed(2)) : null,
        days_with_data: te.query_level.days_with_data,
      };
    }
    sections.push('```json');
    sections.push(JSON.stringify(compact, null, 2));
    sections.push('```');
    if (te?.top_queries_for_url && te.top_queries_for_url.length > 0) {
      sections.push('\n**Top queries ranking for this URL (28d):**');
      for (const q of te.top_queries_for_url.slice(0, 15)) {
        const p = q.avg_position != null ? q.avg_position.toFixed(1) : '—';
        sections.push(`- \`${q.query}\` — ${q.impressions} impressions, ${q.clicks} clicks, position ${p}`);
      }
    }
    if (te?.notes && te.notes.length > 0) {
      sections.push('\n**Target-evidence notes:**');
      for (const n of te.notes) sections.push(`- ${n}`);
    }
    sections.push('\nThese numbers describe the TARGET only. Do not score success against them without a matched post-change window — see Stage D.');
  }

  // ──────────── 5. Site-wide baseline (context only) ────────────
  if (baseline) {
    sections.push('\n## Site-wide baseline (context only — NOT a page-level verdict)');
    sections.push(`Frozen at ${baseline.frozen_at}. Window: ${baseline.window_start ?? '—'} → ${baseline.window_end ?? '—'}.`);
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
    sections.push('These are SITE-WIDE numbers. A site-level lift during the measurement window is NOT proof the targeted change worked. Site-wide movement is context, not a verdict.');
    if (baseline.notes && baseline.notes.length > 0) {
      sections.push('\n**Baseline notes:**');
      for (const n of baseline.notes) sections.push(`- ${n}`);
    }
  }

  // ──────────── 6. Prioritisation + expected upside ────────────
  if (intel) {
    sections.push('\n## Prioritisation + estimated upside');
    sections.push([
      `**Scores (0–100):** impact=${intel.impact_score ?? '—'} · confidence=${intel.confidence_score ?? '—'} · urgency=${intel.urgency_score ?? '—'} · effort=${intel.effort_score ?? '—'} · priority=${intel.priority_score ?? '—'}`,
    ].join('\n'));
    const upsidePresent = intel.expected_upside && Object.keys(intel.expected_upside).length > 0;
    if (upsidePresent) {
      sections.push('\n**Estimated upside (scenario, NOT a forecast):**');
      sections.push('```json');
      sections.push(JSON.stringify(intel.expected_upside, null, 2));
      sections.push('```');
      sections.push('Numbers above describe a plausible scenario IF the intervention lands as hypothesised. They are not a commitment, and a NO CHANGE verdict does not "miss" them.');
    }
  }

  // ──────────── 7. Stage A — Investigate ────────────
  sections.push('\n## Stage A — Investigate');
  sections.push('Before touching code, complete this checklist:');
  const checklist = investigationChecklist(relevance.opportunity_type, repoLabel);
  for (let i = 0; i < checklist.length; i++) sections.push(`${i + 1}. ${checklist[i]}`);
  sections.push('\nIf investigation reveals the recommendation is wrong, the target has changed, or the issue is already resolved, that is a legitimate successful investigation — proceed to Stage B with the honest finding.');

  // ──────────── 8. Stage B — Decide ────────────
  sections.push('\n## Stage B — Decide');
  sections.push('Choose exactly ONE outcome:');
  sections.push([
    '**IMPLEMENT** — the opportunity is valid, the proposed improvement is justified, and the change can be made safely within scope.',
    '**INVESTIGATE_FURTHER** — the opportunity may be valuable, but a significant technical change, ambiguous evidence, or broader SEO risk requires operator approval before proceeding.',
    '**NO_CHANGE** — the opportunity is stale, already resolved, based on incorrect assumptions, or too weak to justify intervention. A NO_CHANGE verdict is a successful outcome; the OS records it as a completed investigation.',
  ].join('\n\n'));
  sections.push('\nDo NOT manufacture a change just to satisfy the original recommendation. The system is designed to accept honest NO_CHANGE verdicts.');

  // ──────────── 9. Stage C — Execute (IMPLEMENT branch only) ────────────
  sections.push('\n## Stage C — Execute (only if Stage B = IMPLEMENT)');
  sections.push('If and only if Stage B produced IMPLEMENT:');
  const executeBullets: string[] = [
    'Make the SMALLEST coherent improvement that addresses the specific target. Do not bundle unrelated improvements.',
    'Preserve existing component / template / helper boundaries. If a change would touch a shared file that renders on many pages, STOP and switch to INVESTIGATE_FURTHER.',
    'Protect ancillary surfaces: canonicals, structured data, affiliate links, pricing + graded data, sitemap, robots.',
    'Run `pnpm typecheck` and `next build` (or site-equivalent) locally for the affected app.',
    'Commit with the CN-05 action ID in the trailer. Push to origin/main.',
    'Wait for Vercel READY on the CORRECT project (verify project id, not just a successful build).',
    'Fetch the live production URL and confirm the change rendered (not just that the Git HEAD updated).',
  ];
  // Add type-specific execute notes
  if (relevance.opportunity_type === 'striking_distance_seo') {
    executeBullets.push('If editing metadata via a `generateMetadata()` function, add a URL-specific case; do not alter the fallback that renders for other pages.');
    executeBullets.push('Smoke-test an UNRELATED card/page on the same site after deploy — ensure its title/meta is unchanged.');
  }
  if (relevance.opportunity_type === 'affiliate_conversion') {
    executeBullets.push('Do not alter Impact Media Partner API attribution helpers (irpid, sharedid, deep-link redirects). They are network-wide.');
  }
  if (relevance.opportunity_type === 'content_gap') {
    executeBullets.push('Route through the OS Articles pipeline. Do not publish directly. Status must end at `draft` or `review`.');
  }
  if (relevance.opportunity_type === 'indexing_issue') {
    executeBullets.push('Indexing fixes often require operator action in GSC. If the fix is "request indexing", mark the receipt with `decision: INVESTIGATE_FURTHER` and attach the GSC inspection output rather than claiming deployment.');
  }
  for (let i = 0; i < executeBullets.length; i++) sections.push(`${i + 1}. ${executeBullets[i]}`);
  sections.push('\n**Approval required** (stop and switch to INVESTIGATE_FURTHER) for: broad SEO changes, canonical/sitemap/robots changes, DB migrations, any change rendering on >5 unrelated pages, pricing-engine changes, affiliate attribution changes, auth / middleware / RLS changes.');

  // ──────────── 10. Stage D — Report ────────────
  sections.push('\n## Stage D — Report');
  sections.push('Return a completion receipt matching the schema below. Fields vary by decision:');
  sections.push('```json');
  sections.push(JSON.stringify({
    action_id: task.id,
    decision: '<IMPLEMENT | INVESTIGATE_FURTHER | NO_CHANGE>',
    implementation_type: implType,
    opportunity_type: relevance.opportunity_type,
    completed_at: '<ISO timestamp>',
    validity_assessment: '<does the OS relevance assessment hold? one paragraph>',
    issue_found: '<what you actually observed on the live page / in the code; one paragraph>',
    evidence_considered: ['<list of files, URLs, GSC queries, deploy SHAs you inspected>'],
    summary_of_what_changed: '<prose; use null when decision = NO_CHANGE>',
    affected_pages_or_features: ['<list; empty when decision = NO_CHANGE>'],
    repository: '<repo slug or N/A>',
    commit_sha: '<sha when decision = IMPLEMENT; null otherwise>',
    production_deployment_sha: '<Vercel prod SHA when decision = IMPLEMENT; null otherwise>',
    tests_performed: ['<typecheck, build, smoke test, URL inspection, etc.>'],
    live_verification: '<url + observed behaviour when deployed; null otherwise>',
    rollback_route: '<single git revert sha / dashboard step / null>',
    primary_success_metric: '<e.g. gsc_clicks_28d_delta on target URL>',
    guardrail_metrics: ['<list>'],
    measurement_recommendation: '<which metric at which window; null when NO_CHANGE>',
    outstanding_issues: '<prose or null>',
  }, null, 2));
  sections.push('```');
  sections.push('Paste this JSON (plus any prose context) into the Action detail screen on the OS. The OS\'s completion-receipt validator accepts NO_CHANGE and INVESTIGATE_FURTHER receipts without a production SHA, and will not falsely credit a NO_CHANGE verdict with site-wide movement.');

  // ──────────── 11. Safety + constraints ────────────
  sections.push('\n## Constraints and risks');
  sections.push([
    '- Preserve existing production functionality. Protect PokePrices SEO recovery.',
    '- Small, independent, reversible commits. Rollback = single `git revert`.',
    '- No DB migrations unless specifically justified by this action\'s evidence.',
    '- No region / sitemap / robots / canonical changes unless the action explicitly asks for them.',
    '- No new paid AI dependencies. This prompt itself is deterministic — do not escalate to an AI service to "review" it.',
    '- No scraping of TCGplayer or other partner surfaces.',
    '- Do NOT mark the action complete merely because a commit was pushed — the completion receipt must include a Vercel READY state for the correct project when decision = IMPLEMENT.',
    '- Do NOT claim deployment success when no change was made. A NO_CHANGE receipt with null commit/deployment SHAs is the correct shape.',
    '- Site-wide GSC/GA4 movement is NOT a verdict on a page-targeted intervention. The OS measurement engine already knows this.',
  ].join('\n'));

  const prompt_text = sections.join('\n');
  // Hash is over the semantic input, NOT the formatted text, so a comment
  // tweak to buildClaudePrompt doesn't invalidate historical hashes.
  // PROMPT_VERSION is part of the hash input — bumping to v2 means
  // regenerating a prompt for the same task produces a different hash,
  // and the v2 entry sits newest-first in metadata.generated_prompts
  // without overwriting the v1 historical entry.
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
    relevance_verdict: relevance.verdict,
    opportunity_type: relevance.opportunity_type,
    target_evidence_window: target_evidence?.window ?? null,
  });
  const prompt_hash = createHash('sha256').update(hashInput).digest('hex');

  return {
    prompt_text,
    prompt_hash,
    prompt_version: PROMPT_VERSION,
    implementation_type: implType,
    relevance,
    created_at: new Date().toISOString(),
  };
}
