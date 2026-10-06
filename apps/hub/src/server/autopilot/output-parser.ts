import 'server-only';

// Strict parser/validator for DraftOutput JSON. Both FIXTURE and REAL
// modes pass through this single function — there is no fixture-only
// render path. A malformed model response fails cleanly with a list
// of structured errors.

import type { DraftOutput, DraftSection } from './types';

export type ParseResult =
  | { ok: true; draft: DraftOutput }
  | { ok: false; errors: ParseError[] };

export interface ParseError {
  path: string;
  message: string;
}

export function parseDraftJson(input: string | Record<string, unknown>): ParseResult {
  let raw: unknown;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (err) {
      return { ok: false, errors: [{ path: '$', message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  } else {
    raw = input;
  }
  return validateDraftShape(raw);
}

export function validateDraftShape(raw: unknown): ParseResult {
  const errors: ParseError[] = [];
  if (!isObject(raw)) {
    return { ok: false, errors: [{ path: '$', message: 'top-level value must be a JSON object' }] };
  }

  const title = pickString(raw, 'title', '$', errors);
  const meta_title = pickString(raw, 'meta_title', '$', errors);
  const meta_description = pickString(raw, 'meta_description', '$', errors);
  const slug = pickSlug(raw, 'slug', '$', errors);
  const featuredRaw = raw['featured_image_source_url'];
  const featured_image_source_url =
    featuredRaw === null || featuredRaw === undefined ? null :
    typeof featuredRaw === 'string' ? featuredRaw :
    (errors.push({ path: '$.featured_image_source_url', message: 'must be string or null' }), null);

  const sectionsRaw = raw['sections'];
  const sections: DraftSection[] = [];
  if (!Array.isArray(sectionsRaw)) {
    errors.push({ path: '$.sections', message: 'must be an array' });
  } else {
    sectionsRaw.forEach((sec, i) => {
      const path = `$.sections[${i}]`;
      if (!isObject(sec)) { errors.push({ path, message: 'must be an object' }); return; }
      const id = pickString(sec, 'id', path, errors);
      const headingRaw = sec['heading'];
      const heading: string | null =
        headingRaw === null || headingRaw === undefined ? null :
        typeof headingRaw === 'string' ? headingRaw :
        (errors.push({ path: `${path}.heading`, message: 'must be string or null' }), null);
      const levelRaw = sec['heading_level'];
      let heading_level: 1 | 2 | 3 | null = null;
      if (levelRaw === null || levelRaw === undefined) heading_level = null;
      else if (levelRaw === 1 || levelRaw === 2 || levelRaw === 3) heading_level = levelRaw;
      else errors.push({ path: `${path}.heading_level`, message: 'must be 1, 2, 3, or null' });
      const paragraphsRaw = sec['paragraphs'];
      const paragraphs: string[] = [];
      if (!Array.isArray(paragraphsRaw)) {
        errors.push({ path: `${path}.paragraphs`, message: 'must be an array of strings' });
      } else {
        paragraphsRaw.forEach((p, j) => {
          if (typeof p !== 'string') errors.push({ path: `${path}.paragraphs[${j}]`, message: 'must be a string' });
          else paragraphs.push(p);
        });
      }
      const linksRaw = sec['internal_links'];
      const internal_links: Array<{ anchor: string; target_url: string }> = [];
      if (Array.isArray(linksRaw)) {
        linksRaw.forEach((l, j) => {
          const lp = `${path}.internal_links[${j}]`;
          if (!isObject(l)) { errors.push({ path: lp, message: 'must be an object' }); return; }
          const anchor = pickString(l, 'anchor', lp, errors);
          const target_url = pickString(l, 'target_url', lp, errors);
          if (anchor && target_url) internal_links.push({ anchor, target_url });
        });
      } else if (linksRaw !== undefined && linksRaw !== null) {
        errors.push({ path: `${path}.internal_links`, message: 'must be an array if present' });
      }
      const imagesRaw = sec['images'];
      const images: Array<{ source_url: string; alt_text: string }> = [];
      if (Array.isArray(imagesRaw)) {
        imagesRaw.forEach((im, j) => {
          const ip = `${path}.images[${j}]`;
          if (!isObject(im)) { errors.push({ path: ip, message: 'must be an object' }); return; }
          const source_url = pickString(im, 'source_url', ip, errors);
          const alt_text = pickString(im, 'alt_text', ip, errors);
          if (source_url && alt_text) images.push({ source_url, alt_text });
        });
      } else if (imagesRaw !== undefined && imagesRaw !== null) {
        errors.push({ path: `${path}.images`, message: 'must be an array if present' });
      }
      if (id) sections.push({ id, heading, heading_level, paragraphs, internal_links, images });
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    draft: {
      title: title ?? '',
      meta_title: meta_title ?? '',
      meta_description: meta_description ?? '',
      slug: slug ?? '',
      featured_image_source_url,
      sections,
    },
  };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function pickString(obj: Record<string, unknown>, key: string, path: string, errors: ParseError[]): string | null {
  const v = obj[key];
  if (typeof v === 'string' && v.length > 0) return v;
  errors.push({ path: `${path}.${key}`, message: 'required string' });
  return null;
}

function pickSlug(obj: Record<string, unknown>, key: string, path: string, errors: ParseError[]): string | null {
  const v = obj[key];
  if (typeof v === 'string' && /^[a-z0-9-]+$/.test(v) && v.length <= 120) return v;
  errors.push({ path: `${path}.${key}`, message: 'required lowercase slug, [a-z0-9-]+, <=120 chars' });
  return null;
}

// Convert a DraftOutput back to JSON (used so the fixture path and
// the real path produce byte-identical artefacts for downstream QA).
export function draftToJson(draft: DraftOutput): string {
  return JSON.stringify(draft);
}
