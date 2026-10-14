import type { TemplateContext, RenderedEmail } from '../types';
import { renderLayout, renderPlainText, esc } from '../layout';

interface HoldingRow {
  name: string;
  valueFormatted: string;
}

function formatMoney(minor: number | null | undefined, currency: string): string | null {
  if (minor == null || !Number.isFinite(minor)) return null;
  const major = minor / 100;
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

function formatDeltaPct(current: number | null, previous: number | null): { label: string; direction: 'up' | 'down' | 'flat' } | null {
  if (current == null || previous == null || previous === 0) return null;
  const diff = current - previous;
  const pct = (diff / Math.abs(previous)) * 100;
  const sign = diff > 0 ? '+' : (diff < 0 ? '−' : '');
  const direction: 'up' | 'down' | 'flat' = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');
  return { label: `${sign}${Math.abs(pct).toFixed(1)}%`, direction };
}

export function renderWeeklyDigest(ctx: TemplateContext): RenderedEmail {
  const { brand, unsubscribeUrl, manageUrl } = ctx;
  const vars = ctx.variables as {
    holdingCount?: number;
    totalValueMinor?: number | null;
    previousValueMinor?: number | null;
    currency?: string;
    topHoldings?: HoldingRow[];
    firstDigest?: boolean;
  };

  const holdingCount = vars.holdingCount ?? 0;
  const currency = vars.currency ?? 'GBP';
  const totalFormatted = formatMoney(vars.totalValueMinor ?? null, currency);
  const delta = formatDeltaPct(vars.totalValueMinor ?? null, vars.previousValueMinor ?? null);
  const firstDigest = vars.firstDigest === true;

  const subject = totalFormatted
    ? `This week in your ${brand.brandName} collection — ${totalFormatted}`
    : `This week in your ${brand.brandName} collection`;
  const preheader = totalFormatted
    ? `${holdingCount} card${holdingCount === 1 ? '' : 's'} tracked · ${totalFormatted}${delta ? ' · ' + delta.label : ''}`
    : `${holdingCount} card${holdingCount === 1 ? '' : 's'} tracked.`;

  const totalBlock = totalFormatted
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 20px;background:#f9fafb;border-radius:8px;padding:16px 20px">
        <tr><td>
          <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Current value</div>
          <div style="font-size:28px;font-weight:700;color:${brand.primaryColor};margin-top:4px">${esc(totalFormatted)}</div>
          ${delta
            ? `<div style="font-size:14px;color:${delta.direction === 'up' ? '#059669' : (delta.direction === 'down' ? '#b91c1c' : '#4b5563')};margin-top:4px">${delta.direction === 'up' ? '▲' : (delta.direction === 'down' ? '▼' : '')} ${esc(delta.label)} vs last week</div>`
            : `<div style="font-size:13px;color:#6b7280;margin-top:4px">${firstDigest ? "We'll start tracking week-over-week changes from your next digest." : 'No prior week to compare.'}</div>`
          }
        </td></tr>
      </table>`
    : `
      <p style="font-size:14px;color:#4b5563;margin:0 0 16px">We don't have a reliable total value for this week — we're sending a basic summary rather than a misleading number.</p>`;

  const rows = (vars.topHoldings ?? []).slice(0, 5);
  const topHtml = rows.length
    ? `
      <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin-top:16px">Top holdings</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 16px">
        ${rows.map(r => `
          <tr>
            <td style="padding:6px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#1f2937">${esc(r.name)}</td>
            <td style="padding:6px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#1f2937;text-align:right">${esc(r.valueFormatted)}</td>
          </tr>`).join('')}
      </table>`
    : '';

  const bodyHtml = `
    <p style="font-size:15px;line-height:1.6;color:#1f2937;margin:0 0 8px">You're tracking <strong>${holdingCount} card${holdingCount === 1 ? '' : 's'}</strong> on ${esc(brand.brandName)}.</p>
    ${totalBlock}
    ${topHtml}
  `;

  const html = renderLayout({
    brand,
    preheader,
    title: `This week on ${brand.brandName}`,
    intro: `Here's your weekly ${esc(brand.gameLabel)} portfolio summary.`,
    bodyHtml,
    ctaUrl: brand.productUrl,
    ctaLabel: 'Open my portfolio',
    unsubscribeUrl,
    manageUrl,
  });

  const text = renderPlainText([
    `Weekly summary from ${brand.brandName}:`,
    totalFormatted ? `Current value: ${totalFormatted}${delta ? ` (${delta.label} vs last week)` : ''}` : `We don't have a reliable total value this week.`,
    `${holdingCount} card${holdingCount === 1 ? '' : 's'} tracked.`,
    rows.length ? `Top holdings:\n${rows.map(r => `  - ${r.name}: ${r.valueFormatted}`).join('\n')}` : '',
    `Open my portfolio: ${brand.productUrl}`,
  ], brand, unsubscribeUrl);

  return { subject, html, text };
}
