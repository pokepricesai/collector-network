import 'server-only';

// Social post orchestrator. Mirrors the Phase 3 content drafts
// module: idea → draft (AI) → human edits → approval → publish.

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateSocialDraft, type SocialVoice, type SocialEvidence, logSocialAiCost } from './ai';

export interface PostDraftResult {
  postId: string;
  threadIds: string[];
  text: string;
  usage: { input_tokens: number; output_tokens: number; est_cost_usd: number; model: string };
}

async function loadVoiceForAccount(sb: SupabaseClient, accountId: string): Promise<SocialVoice> {
  const { data, error } = await sb.from('network_social_voice_profiles')
    .select('label, audience, tone, terminology, do_not, content_mix, example_posts, example_antipatterns')
    .eq('account_id', accountId).maybeSingle();
  if (error) throw new Error(`[social-posts] load voice: ${error.message}`);
  if (!data) throw new Error('[social-posts] no voice profile for account');
  const row = data as unknown as SocialVoice & { example_posts: unknown; example_antipatterns: unknown };
  return {
    label: row.label, audience: row.audience, tone: row.tone,
    terminology: row.terminology, do_not: row.do_not,
    content_mix: row.content_mix as Record<string, number>,
    example_posts: Array.isArray(row.example_posts) ? row.example_posts as string[] : [],
    example_antipatterns: Array.isArray(row.example_antipatterns) ? row.example_antipatterns as string[] : [],
  };
}

async function buildEvidenceForIdea(sb: SupabaseClient, ideaId: string): Promise<SocialEvidence> {
  const { data: ideaRow, error } = await sb.from('network_social_ideas')
    .select('id, working_title, summary, post_type, origin_type, origin_id, origin_entity_type, evidence')
    .eq('id', ideaId).maybeSingle();
  if (error) throw new Error(`[social-posts] load idea: ${error.message}`);
  if (!ideaRow) throw new Error('idea not found');
  const idea = ideaRow as {
    id: string; working_title: string; summary: string | null;
    post_type: string; origin_type: string;
    origin_id: string | null; origin_entity_type: string | null;
    evidence: Record<string, unknown>;
  };

  let objective = 'Share a useful observation grounded in the evidence provided.';
  let source_article: SocialEvidence['source_article'] = null;
  let pricing_fact: SocialEvidence['pricing_fact'] = null;
  let brief_notable: SocialEvidence['brief_notable'] = null;

  if (idea.origin_entity_type === 'article' && idea.origin_id) {
    objective = 'Share the attached published article in a way that captures the reader\'s interest with ONE specific data point from the article itself.';
    const { data: a } = await sb.from('network_articles')
      .select('title, slug, publication_url, summary, primary_query').eq('id', idea.origin_id).maybeSingle();
    if (a) source_article = a as unknown as SocialEvidence['source_article'];
  } else if (idea.origin_type === 'market_mover') {
    objective = 'Flag a notable market mover factually. Lead with the card and the movement. Do not editorialise cause.';
    pricing_fact = idea.evidence;
  } else if (idea.origin_type === 'brief_notable') {
    objective = 'Share a notable network observation from the daily brief. One concrete fact + one honest sentence.';
    brief_notable = idea.evidence;
  }

  return {
    idea: {
      working_title: idea.working_title,
      summary: idea.summary,
      post_type: idea.post_type,
      origin_type: idea.origin_type,
      evidence: idea.evidence,
    },
    source_article, pricing_fact, brief_notable, objective,
  };
}

export async function generatePostDraftFromIdea(
  sb: SupabaseClient,
  ideaId: string,
  adminId: string | null,
  opts: { wantThread?: boolean } = {},
): Promise<PostDraftResult> {
  const { data: ideaRow } = await sb.from('network_social_ideas')
    .select('id, account_id, site_id, post_type').eq('id', ideaId).maybeSingle();
  if (!ideaRow) throw new Error('idea not found');
  const idea = ideaRow as { id: string; account_id: string; site_id: string | null; post_type: 'data_insight' | 'market_mover' | 'article_share' | 'feature_update' | 'network_update' | 'collector_observation' | 'engagement_question' | 'release_note' | 'partner_sponsor' | 'thread' | 'manual' };

  const voice = await loadVoiceForAccount(sb, idea.account_id);
  const evidence = await buildEvidenceForIdea(sb, idea.id);
  const { draft, usage, rawText } = await generateSocialDraft({ voice, evidence, wantThread: opts.wantThread });

  // Create parent post row.
  const linksFromText = extractUrls(draft.primary_text);
  const links = [...new Set([...(draft.links_used ?? []), ...linksFromText])];
  const sourceArticleId = evidence.source_article ? (await findArticleIdBySlug(sb, evidence.source_article.slug)) : null;

  const { data: parentIns, error: parentErr } = await sb.from('network_social_posts').insert({
    account_id: idea.account_id,
    site_id: idea.site_id,
    idea_id: idea.id,
    source_article_id: sourceArticleId,
    parent_post_id: null,
    thread_position: 0,
    post_type: idea.post_type,
    text: draft.primary_text,
    links,
    status: 'draft',
    actor_type: 'ai',
    ai_provider: 'anthropic',
    ai_model: usage.model,
    ai_est_cost_usd: usage.est_cost_usd,
    evidence: {
      objective: evidence.objective,
      source_article: evidence.source_article,
      pricing_fact: evidence.pricing_fact,
      brief_notable: evidence.brief_notable,
      ai_evidence_cited: draft.evidence_cited,
      research_gaps: draft.research_gaps,
      alternative_text: draft.alternative_text ?? null,
      raw_chars: rawText.length,
    },
    created_by: adminId,
  }).select('id').single();
  if (parentErr) throw new Error(`[social-posts] insert parent: ${parentErr.message}`);
  const parentId = (parentIns as { id: string }).id;

  // v1 snapshot
  await sb.rpc('network_snapshot_social_post', {
    p_post_id: parentId,
    p_actor_type: 'ai',
    p_actor_user_id: adminId,
    p_change_note: `AI draft (${usage.model}, ${usage.input_tokens} in / ${usage.output_tokens} out, est $${usage.est_cost_usd.toFixed(4)})`,
  });

  // Thread children if requested.
  const threadIds: string[] = [];
  if (draft.thread && draft.thread.length > 1) {
    for (let i = 0; i < draft.thread.length; i++) {
      const childText = draft.thread[i]!;
      if (childText.length > 280) {
        throw new Error(`[social-posts] thread position ${i + 1} is ${childText.length} chars, exceeds X limit (280)`);
      }
      const { data: childIns } = await sb.from('network_social_posts').insert({
        account_id: idea.account_id,
        site_id: idea.site_id,
        idea_id: idea.id,
        source_article_id: sourceArticleId,
        parent_post_id: parentId,
        thread_position: i + 1,
        post_type: 'thread',
        text: childText,
        links: extractUrls(childText),
        status: 'draft',
        actor_type: 'ai',
        ai_provider: 'anthropic',
        ai_model: usage.model,
        evidence: { parent_post_id: parentId, thread_position: i + 1 },
        created_by: adminId,
      }).select('id').single();
      if (childIns) threadIds.push((childIns as { id: string }).id);
    }
  }

  // Idea status flip.
  await sb.from('network_social_ideas').update({ status: 'drafting' }).eq('id', idea.id);

  // Log cost + audit.
  await logSocialAiCost(sb, { operation: 'social_draft', usage, idea_id: idea.id, actor_user_id: adminId ?? undefined });
  await sb.rpc('network_log_audit', {
    p_action: 'social.ai_draft_generated',
    p_entity_type: 'network_social_post',
    p_entity_id: parentId,
    p_site_id: idea.site_id, p_old_value: null,
    p_new_value: { idea_id: idea.id, text_len: draft.primary_text.length, thread_len: draft.thread?.length ?? 0, cost_usd: usage.est_cost_usd } as unknown as Record<string, unknown>,
    p_actor_type: 'ai', p_source: 'ai_claude',
    p_metadata: { raw_chars: rawText.length } as unknown as Record<string, unknown>,
  });

  return { postId: parentId, threadIds, text: draft.primary_text, usage };
}

export async function approveSocialPost(sb: SupabaseClient, postId: string, adminId: string): Promise<void> {
  // Create approval row for operator sign-off.
  const { data: post } = await sb.from('network_social_posts')
    .select('id, account_id, site_id, text, status').eq('id', postId).maybeSingle();
  if (!post) throw new Error('post not found');
  const p = post as { id: string; account_id: string; site_id: string | null; text: string; status: string };
  if (p.status === 'approved' || p.status === 'scheduled' || p.status === 'published') return;

  const { data: appr } = await sb.from('network_approvals').insert({
    site_id: p.site_id,
    action_type: 'social_post',
    title: `Social post: ${p.text.slice(0, 80)}`,
    description: p.text,
    payload: { post_id: p.id, account_id: p.account_id } as unknown as Record<string, unknown>,
    source_code: 'ai',
    requested_by: 'ai',
    requested_by_id: adminId,
    status: 'approved',
    reviewed_by: adminId,
    reviewed_at: new Date().toISOString(),
  }).select('id').single();
  const approvalId = (appr as { id: string } | null)?.id ?? null;

  await sb.from('network_social_posts').update({
    status: 'approved', approval_id: approvalId,
  }).eq('id', postId);

  await sb.rpc('network_snapshot_social_post', {
    p_post_id: postId, p_actor_type: 'human', p_actor_user_id: adminId,
    p_change_note: 'approved by operator',
  });

  await sb.rpc('network_log_audit', {
    p_action: 'social.approved',
    p_entity_type: 'network_social_post', p_entity_id: postId,
    p_site_id: p.site_id, p_old_value: { status: p.status },
    p_new_value: { status: 'approved', approval_id: approvalId } as unknown as Record<string, unknown>,
    p_actor_type: 'human', p_source: 'manual', p_metadata: {} as unknown as Record<string, unknown>,
  });
}

export async function cancelSocialPost(sb: SupabaseClient, postId: string, adminId: string, reason: string): Promise<void> {
  await sb.from('network_social_posts').update({ status: 'cancelled' }).eq('id', postId);
  await sb.rpc('network_log_audit', {
    p_action: 'social.cancelled', p_entity_type: 'network_social_post', p_entity_id: postId,
    p_site_id: null, p_old_value: null,
    p_new_value: { reason } as unknown as Record<string, unknown>,
    p_actor_type: 'human', p_source: 'manual',
    p_metadata: { actor: adminId } as unknown as Record<string, unknown>,
  });
}

// =============================================================
// X ADAPTER
// =============================================================
//
// The adapter supports three modes:
//   dry_run — generate the exact outgoing payload, do NOT send.
//             Always safe. Used for the Phase 4 acceptance test.
//   preview — same as dry_run but visibly labelled as "preview".
//   live    — send to X API. Requires explicit admin confirmation,
//             non-null external_url after success, and will refuse
//             to send if the post isn't status='approved'.
//
// Credentials come from env vars referenced by
// network_social_accounts.credential_envs. Nothing lands in logs.

export interface PublishResult {
  ok: boolean;
  mode: 'dry_run' | 'preview' | 'live';
  publicationId: string;
  payload: Record<string, unknown>;
  externalPostId: string | null;
  externalUrl: string | null;
  error?: string;
}

export async function publishSocialPost(
  sb: SupabaseClient,
  postId: string,
  adminId: string | null,
  mode: 'dry_run' | 'preview' | 'live',
): Promise<PublishResult> {
  const { data: postRow } = await sb.from('network_social_posts')
    .select('id, account_id, text, links, status, parent_post_id, thread_position').eq('id', postId).maybeSingle();
  if (!postRow) throw new Error('post not found');
  const p = postRow as { id: string; account_id: string; text: string; links: string[]; status: string; parent_post_id: string | null; thread_position: number };

  if (mode === 'live' && p.status !== 'approved' && p.status !== 'scheduled') {
    return {
      ok: false, mode, publicationId: '', payload: {}, externalPostId: null, externalUrl: null,
      error: `post must be status='approved' or 'scheduled' to publish live (current: ${p.status})`,
    };
  }

  const { data: acc } = await sb.from('network_social_accounts')
    .select('id, platform, handle, credential_envs, oauth_state').eq('id', p.account_id).maybeSingle();
  if (!acc) throw new Error('account not found');
  const account = acc as { id: string; platform: string; handle: string; credential_envs: Record<string, string>; oauth_state: string };

  // Build the exact X v2 payload we would POST to /2/tweets.
  const payload: Record<string, unknown> = { text: p.text };
  if (p.parent_post_id) {
    const { data: parent } = await sb.from('network_social_posts')
      .select('external_post_id').eq('id', p.parent_post_id).maybeSingle();
    const parentExternal = (parent as { external_post_id: string | null } | null)?.external_post_id;
    if (parentExternal) {
      (payload as Record<string, unknown>)['reply'] = { in_reply_to_tweet_id: parentExternal };
    } else if (mode === 'live') {
      return {
        ok: false, mode, publicationId: '', payload, externalPostId: null, externalUrl: null,
        error: 'thread parent has no external_post_id yet; publish the head post before children',
      };
    }
  }

  // Record the publication attempt. Idempotency key = post_id + mode
  // for dry_run/preview (one per mode), post_id + attempt_ts for live.
  const idempotencyKey = mode === 'live'
    ? `${postId}:live:${Date.now()}`
    : `${postId}:${mode}`;

  const { data: existing } = await sb.from('network_social_publications')
    .select('id, status, external_post_id, external_url')
    .eq('post_id', postId).eq('idempotency_key', idempotencyKey).maybeSingle();
  if (existing) {
    const e = existing as { id: string; status: string; external_post_id: string | null; external_url: string | null };
    return { ok: e.status === 'success', mode, publicationId: e.id, payload, externalPostId: e.external_post_id, externalUrl: e.external_url };
  }

  if (mode === 'dry_run' || mode === 'preview') {
    const { data: ins } = await sb.from('network_social_publications').insert({
      post_id: postId, account_id: p.account_id,
      idempotency_key: idempotencyKey, mode,
      status: 'success', attempted_at: new Date().toISOString(), completed_at: new Date().toISOString(),
      payload: payload as unknown as Record<string, unknown>,
      response: { note: `${mode} — no X API call made; exact payload captured for inspection` } as unknown as Record<string, unknown>,
    }).select('id').single();
    const id = (ins as { id: string }).id;
    await sb.rpc('network_log_audit', {
      p_action: `social.${mode}`, p_entity_type: 'network_social_post', p_entity_id: postId,
      p_site_id: null, p_old_value: null,
      p_new_value: { mode, publication_id: id, payload } as unknown as Record<string, unknown>,
      p_actor_type: 'human', p_source: 'manual',
      p_metadata: { account: account.handle } as unknown as Record<string, unknown>,
    });
    return { ok: true, mode, publicationId: id, payload, externalPostId: null, externalUrl: null };
  }

  // LIVE path. Only reaches here if mode='live' + post status allows.
  if (account.oauth_state !== 'connected') {
    return {
      ok: false, mode, publicationId: '', payload, externalPostId: null, externalUrl: null,
      error: `X account ${account.handle} is '${account.oauth_state}'. OAuth must be connected before live publish.`,
    };
  }

  const tokenEnv = account.credential_envs['access_token_env'] ?? 'X_USER_ACCESS_TOKEN';
  const accessToken = process.env[tokenEnv];
  if (!accessToken) {
    return {
      ok: false, mode, publicationId: '', payload, externalPostId: null, externalUrl: null,
      error: `env var ${tokenEnv} not set — cannot publish to ${account.handle}`,
    };
  }

  const { data: pubIns } = await sb.from('network_social_publications').insert({
    post_id: postId, account_id: p.account_id,
    idempotency_key: idempotencyKey, mode,
    status: 'pending', attempted_at: new Date().toISOString(),
    payload: payload as unknown as Record<string, unknown>,
  }).select('id').single();
  const publicationId = (pubIns as { id: string }).id;

  try {
    const res = await fetch('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({})) as { data?: { id?: string }; errors?: unknown };
    if (!res.ok || !body.data?.id) {
      const msg = `X API HTTP ${res.status}: ${JSON.stringify(body).slice(0, 400)}`;
      await sb.from('network_social_publications').update({
        status: 'failed', completed_at: new Date().toISOString(),
        response: body as unknown as Record<string, unknown>, error_summary: msg.slice(0, 500),
      }).eq('id', publicationId);
      return { ok: false, mode, publicationId, payload, externalPostId: null, externalUrl: null, error: msg };
    }
    const externalId = body.data.id;
    const externalUrl = `https://x.com/${account.handle}/status/${externalId}`;
    await sb.from('network_social_publications').update({
      status: 'success', completed_at: new Date().toISOString(),
      external_post_id: externalId, external_url: externalUrl,
      response: body as unknown as Record<string, unknown>,
    }).eq('id', publicationId);
    await sb.from('network_social_posts').update({
      status: 'published', posted_at: new Date().toISOString(),
      external_post_id: externalId, external_url: externalUrl,
    }).eq('id', postId);
    await sb.from('network_social_accounts').update({ last_post_at: new Date().toISOString() }).eq('id', p.account_id);
    await sb.rpc('network_log_audit', {
      p_action: 'social.published_live', p_entity_type: 'network_social_post', p_entity_id: postId,
      p_site_id: null, p_old_value: null,
      p_new_value: { external_post_id: externalId, external_url: externalUrl, publication_id: publicationId } as unknown as Record<string, unknown>,
      p_actor_type: 'human', p_source: 'manual',
      p_metadata: { account: account.handle } as unknown as Record<string, unknown>,
    });
    void adminId;
    return { ok: true, mode, publicationId, payload, externalPostId: externalId, externalUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sb.from('network_social_publications').update({
      status: 'failed', completed_at: new Date().toISOString(), error_summary: msg.slice(0, 500),
    }).eq('id', publicationId);
    return { ok: false, mode, publicationId, payload, externalPostId: null, externalUrl: null, error: msg };
  }
}

// --- helpers ----------------------------------------------------
function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s]+/g;
  const out: string[] = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

async function findArticleIdBySlug(sb: SupabaseClient, slug: string): Promise<string | null> {
  const { data } = await sb.from('network_articles').select('id').eq('slug', slug).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
