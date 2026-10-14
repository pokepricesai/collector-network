import type { Brand } from './brand-registry';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface LayoutInput {
  brand: Brand;
  preheader: string;
  title: string;
  intro: string;
  ctaUrl?: string;
  ctaLabel?: string;
  bodyHtml: string;
  footerNoteHtml?: string;
  unsubscribeUrl: string;
  manageUrl: string;
}

export function renderLayout(input: LayoutInput): string {
  const { brand, preheader, title, intro, ctaUrl, ctaLabel, bodyHtml, footerNoteHtml, unsubscribeUrl, manageUrl } = input;
  const logo = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.brandName)}" width="140" style="display:block;max-width:140px;height:auto;margin:0 auto 16px"/>`
    : `<div style="font-weight:700;font-size:20px;color:${brand.primaryColor};text-align:center;letter-spacing:-0.01em;margin-bottom:16px">${esc(brand.brandName)}</div>`;
  const cta = ctaUrl && ctaLabel
    ? `<p style="text-align:center;margin:28px 0"><a href="${esc(ctaUrl)}" style="display:inline-block;background:${brand.accentColor};color:#0b0d13;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px">${esc(ctaLabel)}</a></p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0b0d13">
<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,0.04);padding:32px 28px">
      <tr><td>
        ${logo}
        <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:${brand.primaryColor}">${esc(title)}</h1>
        <p style="font-size:15px;line-height:1.6;margin:0 0 16px;color:#1f2937">${intro}</p>
        ${bodyHtml}
        ${cta}
        ${footerNoteHtml ? `<p style="font-size:14px;line-height:1.5;color:#4b5563;margin:24px 0 0">${footerNoteHtml}</p>` : ''}
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;padding:16px 28px">
      <tr><td style="font-size:12px;color:#6b7280;line-height:1.5;text-align:center">
        You received this from ${esc(brand.brandName)} because you joined the site.<br/>
        <a href="${esc(manageUrl)}" style="color:#6b7280;text-decoration:underline">Manage email preferences</a>
        &nbsp;·&nbsp;
        <a href="${esc(unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a>
        <br/><br/>
        Collector Network &mdash; ${esc(brand.brandName)}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function renderPlainText(parts: readonly string[], brand: Brand, unsubscribeUrl: string): string {
  const body = parts.filter(Boolean).join('\n\n');
  return `${body}

—
${brand.brandName} · Collector Network
Unsubscribe: ${unsubscribeUrl}
`;
}

export { esc };
