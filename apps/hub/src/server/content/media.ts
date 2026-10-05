import 'server-only';

// Reads for the editor's media library + featured-image picker.
// Writes live in the server actions file (media-actions.ts) so they
// can be invoked directly from the form.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface MediaRow {
  id: string;
  site_id: string | null;
  storage_key: string;
  public_url: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  caption: string | null;
  attribution: string | null;
  created_at: string;
}

export interface ArticleMediaRow {
  media_id: string;
  role: 'featured' | 'og' | 'inline';
  position: number | null;
}

// SVG is deliberately excluded. A stored SVG served from the public
// bucket origin can carry <script>, inline event handlers,
// <foreignObject>, and external <use href=…> refs — stored XSS that
// would run on every product-site visitor's browser since those sites
// consume the same bucket. A MIME check alone cannot defend against
// this; we'd need a full XML sanitiser we do not run.
export const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Media attached to a specific article (any role). The editor's
 * media picker uses this to list images available for inline/
 * featured use.
 */
export async function listArticleMedia(
  sb: SupabaseClient,
  articleId: string,
): Promise<Array<MediaRow & { roles: ArticleMediaRow['role'][] }>> {
  const { data: joins, error: joinErr } = await sb
    .from('network_article_media')
    .select('media_id, role, position')
    .eq('article_id', articleId);
  if (joinErr) throw new Error(`[media] joins: ${joinErr.message}`);
  const rows = (joins ?? []) as ArticleMediaRow[];
  if (rows.length === 0) return [];
  const mediaIds = Array.from(new Set(rows.map((r) => r.media_id)));
  const { data: media, error: mErr } = await sb
    .from('network_media')
    .select('id, site_id, storage_key, public_url, file_name, mime_type, byte_size, width, height, alt_text, caption, attribution, created_at')
    .in('id', mediaIds)
    .order('created_at', { ascending: false });
  if (mErr) throw new Error(`[media] rows: ${mErr.message}`);
  const rolesByMedia = new Map<string, ArticleMediaRow['role'][]>();
  for (const r of rows) {
    const b = rolesByMedia.get(r.media_id) ?? [];
    b.push(r.role);
    rolesByMedia.set(r.media_id, b);
  }
  return ((media ?? []) as MediaRow[]).map((m) => ({
    ...m,
    roles: rolesByMedia.get(m.id) ?? [],
  }));
}

/**
 * Resolve the featured image for an article. Prefers an entry in
 * network_article_media with role='featured'; falls back to the
 * `featured_image_id` column on the article itself for legacy rows.
 */
export async function getFeaturedMedia(
  sb: SupabaseClient,
  articleId: string,
  featuredImageIdFallback: string | null,
): Promise<MediaRow | null> {
  const { data: joinRow } = await sb
    .from('network_article_media')
    .select('media_id')
    .eq('article_id', articleId)
    .eq('role', 'featured')
    .limit(1)
    .maybeSingle();
  const mediaId =
    (joinRow as { media_id: string } | null)?.media_id ?? featuredImageIdFallback;
  if (!mediaId) return null;
  const { data } = await sb
    .from('network_media')
    .select('id, site_id, storage_key, public_url, file_name, mime_type, byte_size, width, height, alt_text, caption, attribution, created_at')
    .eq('id', mediaId)
    .maybeSingle();
  return (data as MediaRow | null) ?? null;
}

/**
 * Sanitise an upload filename. Keeps a short, URL-safe stem + the
 * original extension (lowercased). Prevents path traversal and
 * ensures the storage_key stays within the file-name grammar the
 * bucket policy expects.
 */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const extRaw = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const ext = /^[a-z0-9]{1,8}$/.test(extRaw) ? extRaw : 'bin';
  return `${stem || 'image'}.${ext}`;
}
