'use server';

// Media server actions for the article editor. All run with the
// admin's session — never service-role. The admin-write storage
// policies added in migration 20261005030000_network_media_admin_write
// let the admin's auth JWT upload to the network-media bucket.

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import { ALLOWED_MIME, MAX_BYTES, safeFileName } from '@/server/content/media';
import imageSize from 'image-size';

interface UploadResult {
  ok: boolean;
  media?: {
    id: string;
    publicUrl: string;
    width: number | null;
    height: number | null;
    altText: string | null;
    caption: string | null;
  };
  error?: string;
}

/**
 * Upload one image to the network-media bucket and link it to an
 * article as an inline attachment. The editor can then insert the
 * returned URL into the rich-text body. Setting the image as featured
 * is a separate action so Luke can promote an existing inline image.
 */
export async function uploadMediaAction(fd: FormData): Promise<UploadResult> {
  const { admin, sb } = await requireAdmin('/admin/content/articles');

  const articleId = String(fd.get('articleId') ?? '').trim();
  const file = fd.get('file');
  const altText = String(fd.get('altText') ?? '').trim() || null;
  const caption = String(fd.get('caption') ?? '').trim() || null;
  const attribution = String(fd.get('attribution') ?? '').trim() || null;

  if (!articleId) return { ok: false, error: 'missing articleId' };
  if (!(file instanceof File)) return { ok: false, error: 'missing file' };
  if (!ALLOWED_MIME.has(file.type)) {
    return { ok: false, error: `unsupported mime type: ${file.type}` };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `file is ${(file.size / 1024 / 1024).toFixed(1)} MB (max 15 MB)` };
  }
  if (file.size === 0) return { ok: false, error: 'file is empty' };

  // Confirm the article exists + grab its site_id for later linking.
  const { data: article, error: artErr } = await sb
    .from('network_articles')
    .select('id, site_id')
    .eq('id', articleId)
    .maybeSingle();
  if (artErr) return { ok: false, error: `article: ${artErr.message}` };
  if (!article) return { ok: false, error: 'article not found' };
  const siteId = (article as { id: string; site_id: string }).site_id;

  // Build a storage key: articles/<yyyy>/<mm>/<article>/<uuid>-<name>
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const uniq = randomUUID();
  const cleanName = safeFileName(file.name);
  const storageKey = `articles/${yyyy}/${mm}/${articleId}/${uniq}-${cleanName}`;

  // Read bytes, try to extract dimensions. image-size is pure JS and
  // doesn't require a native dependency.
  const buffer = Buffer.from(await file.arrayBuffer());
  let width: number | null = null;
  let height: number | null = null;
  try {
    const dims = imageSize(buffer);
    if (dims.width && dims.height) {
      width = dims.width;
      height = dims.height;
    }
  } catch {
    // Dimension extraction failed (e.g. svg) — proceed without.
  }

  // Upload to the public bucket. The admin's RLS policy on
  // storage.objects authorises this insert.
  const { error: upErr } = await sb.storage
    .from('network-media')
    .upload(storageKey, buffer, {
      cacheControl: 'public, max-age=31536000, immutable',
      contentType: file.type,
      upsert: false,
    });
  if (upErr) {
    return { ok: false, error: `storage: ${upErr.message}` };
  }

  const { data: pub } = sb.storage.from('network-media').getPublicUrl(storageKey);
  const publicUrl = pub.publicUrl;

  // Insert the metadata row.
  const { data: inserted, error: insErr } = await sb
    .from('network_media')
    .insert({
      site_id: siteId,
      storage_bucket: 'network-media',
      storage_key: storageKey,
      public_url: publicUrl,
      file_name: cleanName,
      mime_type: file.type,
      byte_size: file.size,
      width,
      height,
      alt_text: altText,
      caption,
      attribution,
      uploaded_by: admin.adminRowId,
    })
    .select('id, public_url, width, height, alt_text, caption')
    .single();
  if (insErr || !inserted) {
    // Best-effort cleanup of the uploaded object.
    await sb.storage.from('network-media').remove([storageKey]).catch(() => undefined);
    return { ok: false, error: `media row: ${insErr?.message ?? 'unknown'}` };
  }
  const row = inserted as {
    id: string;
    public_url: string;
    width: number | null;
    height: number | null;
    alt_text: string | null;
    caption: string | null;
  };

  // Link to the article as an inline attachment. The role=featured
  // promotion happens through setFeaturedMediaAction.
  await sb.from('network_article_media').insert({
    article_id: articleId,
    media_id: row.id,
    role: 'inline',
  });

  revalidatePath(`/admin/content/articles/${articleId}`);
  return {
    ok: true,
    media: {
      id: row.id,
      publicUrl: row.public_url,
      width: row.width,
      height: row.height,
      altText: row.alt_text,
      caption: row.caption,
    },
  };
}

/**
 * Edit alt text, caption or attribution on an already-uploaded
 * network_media row. Harmless to call repeatedly — fields are only
 * updated when provided.
 */
export async function updateMediaMetaAction(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { sb } = await requireAdmin('/admin/content/articles');
  const mediaId = String(fd.get('mediaId') ?? '').trim();
  const articleId = String(fd.get('articleId') ?? '').trim();
  if (!mediaId) return { ok: false, error: 'missing mediaId' };

  const patch: Record<string, unknown> = {};
  if (fd.has('altText')) patch['alt_text'] = String(fd.get('altText') ?? '') || null;
  if (fd.has('caption')) patch['caption'] = String(fd.get('caption') ?? '') || null;
  if (fd.has('attribution')) patch['attribution'] = String(fd.get('attribution') ?? '') || null;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await sb.from('network_media').update(patch).eq('id', mediaId);
  if (error) return { ok: false, error: error.message };
  if (articleId) revalidatePath(`/admin/content/articles/${articleId}`);
  return { ok: true };
}

/**
 * Promote one media row to featured for an article. Removes any
 * previous featured link for that article so there is only ever one
 * featured image. Also mirrors the id into
 * network_articles.featured_image_id for callers that read the
 * article row directly (e.g. OG tags).
 */
export async function setFeaturedMediaAction(
  articleId: string,
  mediaId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { sb } = await requireAdmin('/admin/content/articles');
  // Delete the existing featured join (if any).
  await sb
    .from('network_article_media')
    .delete()
    .eq('article_id', articleId)
    .eq('role', 'featured');
  // Insert the new featured join (if a media id was supplied).
  if (mediaId) {
    const { error: joinErr } = await sb.from('network_article_media').insert({
      article_id: articleId,
      media_id: mediaId,
      role: 'featured',
    });
    if (joinErr) return { ok: false, error: joinErr.message };
  }
  // Mirror onto network_articles.featured_image_id + featured_image_url.
  let featuredUrl: string | null = null;
  if (mediaId) {
    const { data } = await sb
      .from('network_media')
      .select('public_url')
      .eq('id', mediaId)
      .maybeSingle();
    featuredUrl = (data as { public_url: string } | null)?.public_url ?? null;
  }
  await sb
    .from('network_articles')
    .update({ featured_image_id: mediaId, featured_image_url: featuredUrl })
    .eq('id', articleId);
  revalidatePath(`/admin/content/articles/${articleId}`);
  return { ok: true };
}

/**
 * Detach a media row from an article. Does NOT delete the underlying
 * storage object — a different action owns deletion so the editor
 * can safely remove an image reference without blowing up older
 * versions that still reference it.
 */
export async function detachMediaFromArticleAction(
  articleId: string,
  mediaId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { sb } = await requireAdmin('/admin/content/articles');
  const { error } = await sb
    .from('network_article_media')
    .delete()
    .eq('article_id', articleId)
    .eq('media_id', mediaId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/content/articles/${articleId}`);
  return { ok: true };
}
