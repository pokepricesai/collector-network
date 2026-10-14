import type { TemplateContext, RenderedEmail } from '../types';
import { renderLayout, renderPlainText, esc } from '../layout';

export function renderWelcome(ctx: TemplateContext): RenderedEmail {
  const { brand, unsubscribeUrl, manageUrl } = ctx;
  const firstName = typeof ctx.variables.firstName === 'string' ? (ctx.variables.firstName as string) : null;
  const greeting = firstName ? `Hi ${firstName},` : 'Welcome,';
  const subject = `Welcome to ${brand.brandName}`;
  const preheader = `${brand.brandName} helps you ${brand.productVerb} ${brand.productBlurb}.`;

  const bulletsHtml = `
    <ul style="margin:16px 0;padding-left:20px;color:#1f2937;font-size:15px;line-height:1.7">
      <li>Browse live card prices for ${esc(brand.gameLabel)}.</li>
      <li>Build a portfolio and see what your collection is worth.</li>
      <li>Set alerts for cards you want to track.</li>
    </ul>`;

  const officialLink = brand.officialGameUrl
    ? `<p style="font-size:14px;color:#4b5563;margin:16px 0 0">New to ${esc(brand.gameLabel)}? <a href="${esc(brand.officialGameUrl)}" style="color:${brand.accentColor}">Visit the official site</a>.</p>`
    : '';

  const html = renderLayout({
    brand,
    preheader,
    title: `Welcome to ${brand.brandName}`,
    intro: `${esc(greeting)} thanks for joining ${esc(brand.brandName)} — the fastest way to ${esc(brand.productVerb)} ${esc(brand.productBlurb)}.`,
    bodyHtml: bulletsHtml + officialLink,
    ctaUrl: brand.productUrl,
    ctaLabel: `Open ${brand.brandName}`,
    unsubscribeUrl,
    manageUrl,
  });

  const text = renderPlainText([
    `${greeting}`,
    `Welcome to ${brand.brandName} — the fastest way to ${brand.productVerb} ${brand.productBlurb}.`,
    `• Browse live ${brand.gameLabel} card prices`,
    `• Build a portfolio and see its current value`,
    `• Set alerts for cards you track`,
    `Open ${brand.brandName}: ${brand.productUrl}`,
    brand.officialGameUrl ? `Official game site: ${brand.officialGameUrl}` : '',
  ], brand, unsubscribeUrl);

  return { subject, html, text };
}
