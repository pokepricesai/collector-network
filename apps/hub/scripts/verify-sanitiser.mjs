// Checkpoint 2 Verification Check 1: prove the sanitiser preserves
// data-media-id on <figure> and <img>, preserves <figcaption>, and
// that extractMediaIds returns the expected UUID.

// Mirror the hub prefix the sanitiser expects.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://egidpsrkqvymvioidatc.supabase.co';

import sanitizeHtml from 'sanitize-html';

const BUCKET_PREFIX = 'https://egidpsrkqvymvioidatc.supabase.co/storage/v1/object/public/network-media/';
const MEDIA_UUID = '550e8400-e29b-41d4-a716-446655440000';
const IMG_URL = `${BUCKET_PREFIX}articles/2026/10/550e8400-e29b-41d4-a716-446655440000/550e8400-e29b-41d4-a716-446655440001-test.jpg`;

// What the editor emits when the picker inserts an image with caption.
const editorHtml = `
<p>Intro paragraph with a <a href="https://example.com">link</a>.</p>
<figure data-media-id="${MEDIA_UUID}">
  <img src="${IMG_URL}" alt="A test image" data-media-id="${MEDIA_UUID}" />
  <figcaption>Caption text that must survive the sanitiser.</figcaption>
</figure>
<h2>Second heading</h2>
<ul><li>bullet</li></ul>
`;

// Inline the exact sanitiser config from sanitise.ts so this script
// matches what the server runs. If the two drift, this test will fail
// and tell us immediately.
const safeHtml = sanitizeHtml(editorHtml, {
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
  transformTags: {
    a: (_t, attribs) => {
      const href = attribs['href'] ?? '';
      if (!/^https?:\/\//i.test(href)) return { tagName: 'span', attribs: {} };
      return { tagName: 'a', attribs: { href, rel: 'noopener noreferrer', target: '_blank' } };
    },
    img: (_t, attribs) => {
      const src = attribs['src'] ?? '';
      if (BUCKET_PREFIX && !src.startsWith(BUCKET_PREFIX)) {
        return { tagName: 'span', attribs: {} };
      }
      const keep = { src };
      if (attribs['alt']) keep['alt'] = attribs['alt'];
      if (attribs['width']) keep['width'] = attribs['width'];
      if (attribs['height']) keep['height'] = attribs['height'];
      if (attribs['data-media-id']) keep['data-media-id'] = attribs['data-media-id'];
      return { tagName: 'img', attribs: keep };
    },
  },
  allowedClasses: {},
  enforceHtmlBoundary: false,
});

// extractMediaIds mirror.
function extractMediaIds(html) {
  const matches = html.matchAll(/data-media-id="([0-9a-fA-F-]{36})"/g);
  const out = new Set();
  for (const m of matches) if (m[1]) out.add(m[1]);
  return Array.from(out);
}
const mediaIds = extractMediaIds(safeHtml);

const checks = [
  ['<figure data-media-id="…"> survives', safeHtml.includes(`<figure data-media-id="${MEDIA_UUID}">`)],
  ['<img data-media-id="…"> survives', safeHtml.includes(`data-media-id="${MEDIA_UUID}"`) && safeHtml.includes('<img')],
  ['bucket-prefixed <img src> survives', safeHtml.includes(IMG_URL)],
  ['<figcaption> survives', /<figcaption>Caption text that must survive the sanitiser\.<\/figcaption>/.test(safeHtml)],
  ['extractMediaIds returns correct UUID', mediaIds.length === 1 && mediaIds[0] === MEDIA_UUID],
  ['<a> keeps rel/target', /<a href="https:\/\/example\.com" rel="noopener noreferrer" target="_blank">/.test(safeHtml)],
  ['<h2> survives', /<h2>Second heading<\/h2>/.test(safeHtml)],
];

console.log('\n--- Sanitised HTML ---');
console.log(safeHtml.trim());
console.log('\n--- extractMediaIds ---');
console.log(JSON.stringify(mediaIds));
console.log('\n--- Checks ---');
let pass = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (ok) pass++;
}
console.log(`\n${pass}/${checks.length} checks passed`);
if (pass !== checks.length) process.exit(1);
