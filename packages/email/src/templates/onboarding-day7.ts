import type { TemplateContext, RenderedEmail } from '../types';
import { renderLayout, renderPlainText, esc } from '../layout';

export function renderOnboardingDay7(ctx: TemplateContext): RenderedEmail {
  const { brand, unsubscribeUrl, manageUrl } = ctx;
  const hasPortfolio = ctx.variables.hasPortfolio === true;

  const subject = `A week in: tools you may have missed on ${brand.brandName}`;
  const preheader = `Price history, alerts, and the full ${brand.gameLabel} browser.`;

  const bodyHtml = `
    <p style="font-size:15px;line-height:1.6;color:#1f2937;margin:0 0 16px">You've been with ${esc(brand.brandName)} for about a week. Here are three features worth trying:</p>
    <ol style="margin:0 0 16px;padding-left:20px;color:#1f2937;font-size:15px;line-height:1.7">
      <li><strong>Price history.</strong> Every card has a full price chart — handy before you buy or sell.</li>
      <li><strong>Watchlist alerts.</strong> Track cards you don't own yet; we'll email you when the price moves.</li>
      <li><strong>Set browser.</strong> See every card in a set at once, sorted by price or rarity.</li>
    </ol>
    ${hasPortfolio
      ? `<p style="font-size:14px;color:#4b5563;margin:16px 0 0">Your portfolio will start getting weekly value updates from here on.</p>`
      : `<p style="font-size:14px;color:#4b5563;margin:16px 0 0">If you add a portfolio, you'll get a weekly value snapshot.</p>`
    }`;

  const html = renderLayout({
    brand,
    preheader,
    title: `A week with ${brand.brandName}`,
    intro: `Hope ${esc(brand.brandName)} is proving useful.`,
    bodyHtml,
    ctaUrl: brand.productUrl,
    ctaLabel: `Explore ${brand.brandName}`,
    unsubscribeUrl,
    manageUrl,
  });

  const text = renderPlainText([
    `You've been with ${brand.brandName} for a week. Three features worth trying:`,
    `1. Price history — every card has a full chart.\n2. Watchlist alerts — we email you when a card moves.\n3. Set browser — see a whole set at once.`,
    hasPortfolio
      ? `Your portfolio will start getting weekly value updates.`
      : `Add a portfolio and you'll get a weekly value snapshot.`,
    `Open ${brand.brandName}: ${brand.productUrl}`,
  ], brand, unsubscribeUrl);

  return { subject, html, text };
}
