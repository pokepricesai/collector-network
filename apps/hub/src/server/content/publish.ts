import 'server-only';

// Publishing orchestrator. All publication paths flow through this
// module so approval + change-log integration + error handling is
// unified. Each site has an adapter that knows how to deliver the
// article to the target site's architecture.
//
// Adapters:
//
//   ygo_db / onepiece_db / lorcana_db — "shared Supabase":
//     these three sites' /insights/[slug] pages read a fallback row
//     from network_articles when the hardcoded TSX registry doesn't
//     contain the slug. "Publishing" sets status='published' +
//     publication_url + published_at + revalidates the public path.
//     No external calls needed — the three sites already live on
//     the CN OS Supabase project.
//
//   pokeprices_external — "manual deliver":
//     PokePrices has its own `/admin/insights` CMS in a SEPARATE
//     Supabase project. CN cannot write to it directly without
//     adding a new credential path. The adapter instead:
//       1. Marks the publication 'manual_pending'
//       2. Produces the exact payload the PokePrices admin UI
//          accepts (headline + body_markdown + meta_* + slug)
//       3. Operator pastes it into PokePrices' editor.
//     Status flips to 'success' once the operator records the
//     resulting PokePrices URL via /admin/content/articles/[id].
//
//   mtgprices_markdown — "manual commit":
//     MTGPrices content is markdown files in mtgprices-web/src/
//     content/insights. The adapter emits the exact .md payload
//     (front-matter + body) for the operator to commit. Same
//     'manual_pending' → 'success' flow.
//
// Safety: nothing public happens unless the article is 'approved'.
// The adapter checks explicitly and refuses otherwise.

import type { SupabaseClient } from '@supabase/supabase-js';

type PubTarget = 'ygo_db' | 'onepiece_db' | 'lorcana_db' | 'pokeprices_external' | 'mtgprices_markdown';

export interface PublishResult {
  ok: boolean;
  publicationId: string;
  publicationUrl: string | null;
  requiresManualAction: boolean;
  manualPayload?: { kind: 'pokeprices' | 'mtg_markdown'; content: string; filename?: string };
  seoChangeId: string | null;
  error?: string;
}

const DB_TARGETS: PubTarget[] = ['ygo_db', 'onepiece_db', 'lorcana_db'];

/**
 * Publish an article. Behaviour depends on `mode`:
 *
 *   mode='preview'  — safe non-public dry run. Creates a
 *                     network_content_publications row with
 *                     status='preview' and the payload the adapter
 *                     would send. Does NOT flip the article to
 *                     'published'. Useful for the acceptance test.
 *
 *   mode='publish'  — actual publish. Requires status='approved'.
 *                     Writes a 'published' or 'manual_pending'
 *                     publication row, flips the article, logs an
 *                     SEO change, and (for DB targets) revalidates
 *                     the public path.
 */
export async function publishArticle(
  sb: SupabaseClient,
  articleId: string,
  adminId: string | null,
  mode: 'preview' | 'publish',
): Promise<PublishResult> {
  const { data: artRow, error: artErr } = await sb
    .from('network_articles')
    .select('id, site_id, title, slug, body, body_format, publication_target, status, meta_title, meta_description, summary, primary_query, secondary_queries, author, network_sites(slug, canonical_url)')
    .eq('id', articleId).maybeSingle();
  if (artErr) throw new Error(`[publish] load article: ${artErr.message}`);
  if (!artRow) throw new Error('article not found');
  const a = artRow as unknown as {
    id: string; site_id: string; title: string; slug: string; body: string; body_format: string;
    publication_target: PubTarget; status: string;
    meta_title: string | null; meta_description: string | null; summary: string | null;
    primary_query: string | null; secondary_queries: string[]; author: string;
    network_sites: { slug: string; canonical_url: string };
  };

  if (mode === 'publish' && a.status !== 'approved') {
    return {
      ok: false, publicationId: '', publicationUrl: null, requiresManualAction: false, seoChangeId: null,
      error: `article must be status='approved' to publish (current: ${a.status})`,
    };
  }

  // Dispatch to adapter
  let publicationUrl: string | null = null;
  let adapterStatus: 'success' | 'manual_pending' | 'preview' | 'failed' = 'preview';
  let payload: Record<string, unknown> = {};
  let manualPayload: PublishResult['manualPayload'];

  const canonicalBase = a.network_sites.canonical_url.replace(/\/$/, '');

  if (DB_TARGETS.includes(a.publication_target)) {
    // DB adapter — the public /insights/[slug] route on these sites
    // will fall through to this article row once status='published'.
    publicationUrl = `${canonicalBase}/insights/${a.slug}`;
    payload = { adapter: 'db_fallback', slug: a.slug, site_slug: a.network_sites.slug, canonical: publicationUrl };
    adapterStatus = mode === 'publish' ? 'success' : 'preview';
  } else if (a.publication_target === 'mtgprices_markdown') {
    const frontMatter = [
      '---',
      `slug: ${a.slug}`,
      `title: ${JSON.stringify(a.title).slice(1, -1)}`,
      `description: ${JSON.stringify(a.meta_description ?? a.summary ?? '').slice(1, -1)}`,
      `author: ${a.author}`,
      `category: Market`,          // operator can adjust
      `publishedAt: ${new Date().toISOString().slice(0, 10)}`,
      '---',
      '',
    ].join('\n');
    const content = frontMatter + (a.body ?? '');
    publicationUrl = `${canonicalBase}/insights/${a.slug}`;
    payload = { adapter: 'mtgprices_markdown', filename: `src/content/insights/${a.slug}.md`, canonical: publicationUrl };
    manualPayload = { kind: 'mtg_markdown', content, filename: `src/content/insights/${a.slug}.md` };
    adapterStatus = mode === 'publish' ? 'manual_pending' : 'preview';
  } else if (a.publication_target === 'pokeprices_external') {
    const pokeprices = {
      headline: a.title,
      slug: a.slug,
      meta_title: a.meta_title,
      meta_description: a.meta_description,
      summary: a.summary,
      body_markdown: a.body,
      primary_query: a.primary_query,
      secondary_queries: a.secondary_queries ?? [],
      author: a.author,
    };
    publicationUrl = `${canonicalBase}/insights/${a.slug}`;
    payload = { adapter: 'pokeprices_external', target_slug: a.slug, canonical: publicationUrl };
    manualPayload = { kind: 'pokeprices', content: JSON.stringify(pokeprices, null, 2) };
    adapterStatus = mode === 'publish' ? 'manual_pending' : 'preview';
  } else {
    return {
      ok: false, publicationId: '', publicationUrl: null, requiresManualAction: false, seoChangeId: null,
      error: `unsupported publication_target: ${a.publication_target}`,
    };
  }

  // Insert publication row
  const { data: pubIns, error: pubErr } = await sb
    .from('network_content_publications')
    .insert({
      article_id: a.id,
      site_id: a.site_id,
      publication_target: a.publication_target,
      publication_url: publicationUrl,
      payload: payload as unknown as Record<string, unknown>,
      status: adapterStatus,
      attempted_at: new Date().toISOString(),
      completed_at: adapterStatus === 'success' ? new Date().toISOString() : null,
    })
    .select('id').single();
  if (pubErr) throw new Error(`[publish] insert publication: ${pubErr.message}`);
  const publicationId = (pubIns as { id: string }).id;

  let seoChangeId: string | null = null;

  if (mode === 'publish') {
    // Flip article status
    const newStatus = adapterStatus === 'success' ? 'published' : 'publishing';
    const update: Record<string, unknown> = {
      status: newStatus,
      publication_url: publicationUrl,
    };
    if (adapterStatus === 'success') {
      update['published_at'] = new Date().toISOString();
    }
    await sb.from('network_articles').update(update).eq('id', a.id);

    // Record SEO change (even for manual_pending; the operator will
    // later confirm, but we want the before/after window to start now).
    const { data: seoChange, error: seoErr } = await sb
      .from('network_seo_changes')
      .insert({
        site_id: a.site_id,
        change_type: 'content',
        title: `Published article: ${a.title}`,
        description: a.summary ?? a.meta_description,
        url: publicationUrl,
        source: 'ai',
        actor: 'Collector Network OS',
        actor_user_id: adminId,
        status: adapterStatus === 'success' ? 'deployed' : 'proposed',
        evidence: { article_id: a.id, publication_id: publicationId, primary_query: a.primary_query } as unknown as Record<string, unknown>,
      })
      .select('id').single();
    if (!seoErr && seoChange) {
      seoChangeId = (seoChange as { id: string }).id;
      await sb.from('network_articles').update({ seo_change_id: seoChangeId }).eq('id', a.id);
      await sb.from('network_content_publications').update({ seo_change_id: seoChangeId }).eq('id', publicationId);
    }

    // Also flip the originating idea → 'published'.
    const { data: ideaLink } = await sb.from('network_articles').select('idea_id').eq('id', a.id).maybeSingle();
    const ideaId = (ideaLink as { idea_id: string | null } | null)?.idea_id;
    if (ideaId) {
      await sb.from('network_content_ideas').update({ status: 'published' }).eq('id', ideaId);
    }

    await sb.rpc('network_log_audit', {
      p_action: adapterStatus === 'success' ? 'article.published' : 'article.manual_pending',
      p_entity_type: 'network_article',
      p_entity_id: a.id,
      p_site_id: a.site_id,
      p_old_value: { status: a.status } as unknown as Record<string, unknown>,
      p_new_value: { status: newStatus, publication_url: publicationUrl, publication_id: publicationId, seo_change_id: seoChangeId } as unknown as Record<string, unknown>,
      p_actor_type: 'human',
      p_source: 'manual',
      p_metadata: { target: a.publication_target } as unknown as Record<string, unknown>,
    });

    // For DB-driven sites, revalidate the public /insights path on
    // the target site. We can't reach cross-app revalidation from
    // here directly — the three sites use their own ISR/SSR config
    // (revalidate=1800 on the YGO slug page). Operator confirms via
    // the publish-complete button after publishing.
  } else {
    // Preview mode — audit without state change.
    await sb.rpc('network_log_audit', {
      p_action: 'article.preview_published',
      p_entity_type: 'network_article',
      p_entity_id: a.id,
      p_site_id: a.site_id,
      p_old_value: null,
      p_new_value: { preview_publication_id: publicationId, target: a.publication_target } as unknown as Record<string, unknown>,
      p_actor_type: 'human',
      p_source: 'manual',
      p_metadata: {} as unknown as Record<string, unknown>,
    });
  }

  return {
    ok: true, publicationId, publicationUrl,
    requiresManualAction: adapterStatus === 'manual_pending',
    manualPayload, seoChangeId,
  };
}

/**
 * Public read for DB-driven articles. Used by the three monorepo
 * sites' /insights/[slug] routes as a fallback when the hardcoded
 * registry doesn't contain the slug. Only returns 'published'
 * articles belonging to that site.
 */
export async function fetchPublishedDbArticle(
  sb: SupabaseClient,
  siteSlug: 'ygo' | 'onepiece' | 'lorcana',
  slug: string,
): Promise<{
  id: string; title: string; summary: string | null; body: string; body_format: string;
  meta_title: string | null; meta_description: string | null;
  publication_url: string | null; published_at: string | null; updated_at: string;
  author: string;
} | null> {
  const target = `${siteSlug}_db` as PubTarget;
  const { data, error } = await sb
    .from('network_articles')
    .select('id, title, summary, body, body_format, meta_title, meta_description, publication_url, published_at, updated_at, author, publication_target, status')
    .eq('slug', slug).eq('status', 'published').eq('publication_target', target).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as {
    id: string; title: string; summary: string | null; body: string; body_format: string;
    meta_title: string | null; meta_description: string | null;
    publication_url: string | null; published_at: string | null; updated_at: string;
    author: string;
  };
  return row;
}

/**
 * List published DB-driven articles for a site. Used for /insights
 * index pages to merge DB articles with the hardcoded registry.
 */
export async function listPublishedDbArticles(
  sb: SupabaseClient,
  siteSlug: 'ygo' | 'onepiece' | 'lorcana',
): Promise<Array<{ slug: string; title: string; summary: string | null; published_at: string | null; updated_at: string }>> {
  const target = `${siteSlug}_db` as PubTarget;
  const { data } = await sb
    .from('network_articles')
    .select('slug, title, summary, published_at, updated_at')
    .eq('status', 'published').eq('publication_target', target)
    .order('published_at', { ascending: false });
  return ((data ?? []) as unknown as Array<{ slug: string; title: string; summary: string | null; published_at: string | null; updated_at: string }>);
}
