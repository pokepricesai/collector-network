import type { TemplateContext, RenderedEmail } from '../types';
import { renderLayout, renderPlainText, esc } from '../layout';

export function renderOnboardingDay2(ctx: TemplateContext): RenderedEmail {
  const { brand, unsubscribeUrl, manageUrl } = ctx;
  const hasPortfolio = ctx.variables.hasPortfolio === true;
  const holdingCount = typeof ctx.variables.holdingCount === 'number' ? (ctx.variables.holdingCount as number) : 0;

  const subject = hasPortfolio
    ? `Make your ${brand.brandName} collection work for you`
    : `Try the ${brand.brandName} portfolio in 2 minutes`;

  const preheader = hasPortfolio
    ? `You've added ${holdingCount} card${holdingCount === 1 ? '' : 's'} — here's how to get more from them.`
    : `A portfolio shows what your collection is worth right now.`;

  const bodyHtml = hasPortfolio
    ? `
      <p style="font-size:15px;line-height:1.6;color:#1f2937;margin:0 0 16px">You've already added ${holdingCount} card${holdingCount === 1 ? '' : 's'} to ${esc(brand.brandName)}. Nice start.</p>
      <p style="font-size:15px;line-height:1.6;color:#1f2937;margin:0 0 16px">A few things to try next:</p>
      <ul style="margin:0 0 16px;padding-left:20px;color:#1f2937;font-size:15px;line-height:1.7">
        <li>Open your portfolio to see its current total value.</li>
        <li>Set a price alert on your highest-value card.</li>
        <li>Browse related sets to spot gaps.</li>
      </ul>`
    : `
      <p style="font-size:15px;line-height:1.6;color:#1f2937;margin:0 0 16px">A portfolio on ${esc(brand.brandName)} shows what your cards are worth right now, updates with the market, and keeps a running history.</p>
      <p style="font-size:15px;line-height:1.6;color:#1f2937;margin:0 0 16px">You can start with one card — add more whenever.</p>`;

  const html = renderLayout({
    brand,
    preheader,
    title: hasPortfolio ? 'Get more from your collection' : 'Build your first portfolio',
    intro: hasPortfolio
      ? `Thanks for giving ${esc(brand.brandName)} a go.`
      : `Thanks for joining ${esc(brand.brandName)}.`,
    bodyHtml,
    ctaUrl: brand.productUrl,
    ctaLabel: hasPortfolio ? 'Open my portfolio' : 'Add my first card',
    unsubscribeUrl,
    manageUrl,
  });

  const text = renderPlainText([
    hasPortfolio
      ? `You've added ${holdingCount} card${holdingCount === 1 ? '' : 's'} to ${brand.brandName}. Here's how to get more from them:`
      : `A portfolio on ${brand.brandName} shows what your cards are worth right now and keeps a running history.`,
    hasPortfolio
      ? `• See your current total value\n• Set a price alert on your highest-value card\n• Browse related sets to spot gaps`
      : `You can start with just one card.`,
    `Open ${brand.brandName}: ${brand.productUrl}`,
  ], brand, unsubscribeUrl);

  return { subject, html, text };
}
