// HTML + plain-text renderer for auth emails.
//
// Pure. Input is a brand + action + verified action URL + safe
// display copy. Output is { subject, html, text }. No tokens or
// secrets appear in log-facing values.
//
// Copy conventions per CN-C spec:
//   - transactional only, no newsletter/promotional content
//   - no em dashes in visible copy
//   - concise; one primary CTA + plain-text link fallback
//   - explains why the user received the email in the footer

import type { EmailActionType } from './types.ts';
import type { Brand } from './brand-registry.ts';

export interface RenderInput {
  brand: Brand;
  action: EmailActionType;
  // 'to_current' / 'to_new' distinguishes the two emails sent for
  // an email_change action. For every other action type we use
  // 'default'.
  variant?: 'default' | 'to_current' | 'to_new';
  // The fully-formed URL the CTA button links to. Callers build
  // this from the Supabase verify pattern; we do not re-embed
  // token_hash or the redirect target here.
  actionUrl: string;
  // Recipient address, used only in the footer helper text
  // ("This email was sent to {email}."). Not logged.
  recipientEmail: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface CopyBlock {
  subject: string;
  headline: string;
  body: string;
  cta: string;
}

// Compose per-action copy using the brand name + product blurb.
// Kept as a function of (brand, action, variant) so tests can
// exercise every combination deterministically.
export function copyFor(
  brand: Brand,
  action: EmailActionType,
  variant: 'default' | 'to_current' | 'to_new' = 'default',
): CopyBlock {
  const B = brand.brandName;
  const blurb = brand.productBlurb;
  switch (action) {
    case 'signup':
      return {
        subject: `Confirm your ${B} account`,
        headline: `Confirm your ${B} account`,
        body:
          `Confirm your email to finish creating your account and access ${blurb}.`,
        cta: 'Confirm account',
      };
    case 'recovery':
      return {
        subject: `Reset your ${B} password`,
        headline: `Reset your ${B} password`,
        body:
          `Someone requested a password reset for your ${B} account. If this was you, click the button below. If not, you can ignore this email and your password will stay the same.`,
        cta: 'Reset password',
      };
    case 'magiclink':
      return {
        subject: `Sign in to ${B}`,
        headline: `Sign in to ${B}`,
        body:
          `Click the button below to sign in to ${B}. This link works once and expires shortly.`,
        cta: 'Sign in',
      };
    case 'invite':
      return {
        subject: `You are invited to ${B}`,
        headline: `Welcome to ${B}`,
        body:
          `You have been invited to join ${B}. Click below to accept the invitation and set your password.`,
        cta: 'Accept invitation',
      };
    case 'reauthentication':
      return {
        subject: `Verify your ${B} action`,
        headline: 'Please confirm your action',
        body:
          `Confirm this sensitive action on your ${B} account by clicking below. If you did not request this, secure your account immediately.`,
        cta: 'Verify action',
      };
    case 'email_change':
      if (variant === 'to_current') {
        return {
          subject: `Confirm your ${B} email change`,
          headline: 'Confirm your email change',
          body:
            `You (or someone using your ${B} account) requested to change the email address on file. Click below from your current inbox to confirm the change.`,
          cta: 'Confirm change',
        };
      }
      // 'to_new' (or 'default') → notice on the new address.
      return {
        subject: `Confirm your new ${B} email`,
        headline: 'Confirm your new email',
        body:
          `Click below to confirm that this address should become the new email for your ${B} account.`,
        cta: 'Confirm new email',
      };
  }
}

// Escape user-supplied strings before dropping them into the HTML.
// Applied to the recipient email string in the footer only; every
// other visible string is app-owned.
function htmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Very small email-safe HTML layout. Inline styles only. No
// external CSS. No custom fonts.
export function renderAuthEmail(input: RenderInput): RenderedEmail {
  const copy = copyFor(input.brand, input.action, input.variant ?? 'default');
  const accent = input.brand.accentColor;
  const bg = '#f5f5f7';
  const card = '#ffffff';
  const text = '#1c1e26';
  const muted = '#5b6070';
  const line = '#e7e8ec';
  const brandName = htmlEscape(input.brand.brandName);
  const heading = htmlEscape(copy.headline);
  const body = htmlEscape(copy.body);
  const cta = htmlEscape(copy.cta);
  const url = input.actionUrl; // safe: constructed from validated payload only
  const recipient = htmlEscape(input.recipientEmail);
  const support = input.brand.supportUrl;
  const logoHtml = input.brand.logoUrl
    ? `<img src="${input.brand.logoUrl}" alt="${brandName}" height="32" style="display:block;height:32px;width:auto;border:0;outline:none;text-decoration:none;">`
    : `<span style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:18px;font-weight:700;color:${text};letter-spacing:0.02em;">${brandName}</span>`;

  const htmlSrc = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title></head>`,
    `<body style="margin:0;padding:0;background:${bg};font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${text};">`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${bg};padding:32px 16px;">`,
    `<tr><td align="center">`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:${card};border:1px solid ${line};border-radius:12px;overflow:hidden;">`,
    `<tr><td style="padding:24px 28px;border-bottom:1px solid ${line};">${logoHtml}</td></tr>`,
    `<tr><td style="padding:28px;">`,
    `<h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;font-weight:700;color:${text};">${heading}</h1>`,
    `<p style="margin:0 0 24px 0;font-size:14px;line-height:1.55;color:${text};">${body}</p>`,
    `<p style="margin:0 0 20px 0;">`,
    `<a href="${url}" style="display:inline-block;background:${accent};color:${text};text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:700;font-size:14px;">${cta}</a>`,
    `</p>`,
    `<p style="margin:0 0 6px 0;font-size:12px;color:${muted};">If the button does not work, paste this link into your browser:</p>`,
    `<p style="margin:0;font-size:12px;color:${muted};word-break:break-all;"><a href="${url}" style="color:${muted};">${url}</a></p>`,
    `</td></tr>`,
    `<tr><td style="padding:20px 28px;border-top:1px solid ${line};font-size:11.5px;color:${muted};line-height:1.5;">`,
    `This email was sent to ${recipient} because a ${brandName} account action was requested for it. If you did not request this, you can safely ignore this email.`,
    `<br><br>`,
    `<a href="${support}" style="color:${muted};">${brandName}</a> is part of the Collector Network.`,
    `</td></tr>`,
    `</table>`,
    `</td></tr>`,
    `</table>`,
    `</body></html>`,
  ].join('');

  const textSrc = [
    copy.headline,
    '',
    copy.body,
    '',
    `${copy.cta}: ${url}`,
    '',
    `This email was sent to ${input.recipientEmail} because a ${input.brand.brandName} account action was requested for it. If you did not request this, you can safely ignore this email.`,
    `${input.brand.brandName} is part of the Collector Network. ${support}`,
  ].join('\n');

  return { subject: copy.subject, html: htmlSrc, text: textSrc };
}
