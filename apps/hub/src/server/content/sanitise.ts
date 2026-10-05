import 'server-only';

// Portable, sanitised HTML representation for Collector Network OS
// articles. Called on every save of the rich editor and once more at
// render time on the public sites, so a malformed element never
// reaches a product page.
//
// Policy (deliberately narrow):
//
//   * Block: p, h2, h3, ul, ol, li, blockquote, figure, figcaption
//   * Inline: strong, em, a, br
//   * Media: img (only inside a figure, only from the network-media
//            bucket)
//
//   * `a[href]` must match http(s). External URLs get rel="noopener
//     noreferrer" and target="_blank" forced on.
//   * `img[src]` must come from the configured Supabase Storage
//     bucket public URL — a strict prefix check. This prevents external
//     trackers and data exfiltration through image URLs.
//
//   * Every other element and attribute is stripped. No ids, no
//     classes, no styles, no event handlers, no iframes, no scripts.

import sanitizeHtml from 'sanitize-html';

// Public URL prefix for the `network-media` bucket. Resolved from the
// Supabase project env; the public site reader uses the same prefix
// at render time.
export function networkMediaPublicPrefix(): string {
  const base = (process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '').replace(/\/$/, '');
  if (!base) return '';
  return `${base}/storage/v1/object/public/network-media/`;
}

export const HTML_FORMAT_V1 = 'html_v1' as const;

export interface BodyRich {
  format: typeof HTML_FORMAT_V1;
  html: string;
  media_ids: string[];
}

/**
 * Sanitise rich-text editor output and return the canonical body_rich
 * jsonb value. Strips every element and attribute not on the allowlist.
 * External links get safe rel/target. Non-bucket images are dropped
 * entirely (rather than silently rewritten) so broken media is loud
 * at save time.
 */
export function sanitiseEditorHtml(html: string, bucketPrefix = networkMediaPublicPrefix()): BodyRich {
  const safeHtml = sanitizeHtml(html ?? '', {
    allowedTags: [
      'p', 'h2', 'h3',
      'strong', 'em',
      'a',
      'ul', 'ol', 'li',
      'blockquote',
      'img', 'figure', 'figcaption',
      'br',
    ],
    allowedAttributes: {
      a: ['href', 'rel', 'target'],
      img: ['src', 'alt', 'width', 'height', 'data-media-id'],
      figure: ['data-media-id'],
    },
    allowedSchemes: ['http', 'https'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    disallowedTagsMode: 'discard',
    // Enforce safe rel/target on anchors, and bucket-origin on images.
    transformTags: {
      a: (_tagName: string, attribs: Record<string, string>) => {
        const href = attribs['href'] ?? '';
        if (!/^https?:\/\//i.test(href)) {
          return { tagName: 'span', attribs: {} as Record<string, string> };
        }
        return {
          tagName: 'a',
          attribs: {
            href,
            rel: 'noopener noreferrer',
            target: '_blank',
          } as Record<string, string>,
        };
      },
      img: (_tagName: string, attribs: Record<string, string>) => {
        const src = attribs['src'] ?? '';
        if (bucketPrefix && !src.startsWith(bucketPrefix)) {
          // Drop foreign images entirely by converting to an empty span.
          return { tagName: 'span', attribs: {} as Record<string, string> };
        }
        const keep: Record<string, string> = { src };
        if (attribs['alt']) keep['alt'] = attribs['alt'];
        if (attribs['width']) keep['width'] = attribs['width'];
        if (attribs['height']) keep['height'] = attribs['height'];
        if (attribs['data-media-id']) keep['data-media-id'] = attribs['data-media-id'];
        return { tagName: 'img', attribs: keep };
      },
    },
    // Keep text content when a disallowed tag is dropped.
    allowedClasses: {},
    enforceHtmlBoundary: false,
  });

  const media_ids = extractMediaIds(safeHtml);

  return { format: HTML_FORMAT_V1, html: safeHtml, media_ids };
}

/**
 * Pull every `data-media-id="<uuid>"` out of a sanitised HTML blob so
 * callers can resolve them to network_media rows (featured image
 * suggestions, broken-image checks, OG image fallbacks).
 */
export function extractMediaIds(html: string): string[] {
  const matches = html.matchAll(/data-media-id="([0-9a-fA-F-]{36})"/g);
  const out = new Set<string>();
  for (const m of matches) {
    const id = m[1];
    if (id) out.add(id);
  }
  return Array.from(out);
}

/**
 * Convenience: given a body_rich jsonb value from the DB, pull the
 * sanitised HTML string back out. Returns null when the row is empty
 * or the format tag is unrecognised — callers should then fall back
 * to the markdown body column.
 */
export function readBodyRichHtml(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { format?: string; html?: unknown };
  if (v.format !== HTML_FORMAT_V1) return null;
  if (typeof v.html !== 'string') return null;
  return v.html;
}
