import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandForHostname, NEUTRAL_BRAND } from './brand-registry.ts';
import { copyFor, renderAuthEmail } from './render-email.ts';

const ygo = brandForHostname('ygoprices.io');
const mtg = brandForHostname('mtgprices.io');

test('signup rendering — YGO brand', () => {
  const r = renderAuthEmail({
    brand: ygo,
    action: 'signup',
    actionUrl: 'https://egidpsrkqvymvioidatc.supabase.co/auth/v1/verify?token=X&type=signup&redirect_to=https%3A%2F%2Fygoprices.io%2Fauth%2Fcallback',
    recipientEmail: 'alice@example.com',
  });
  assert.match(r.subject, /YGOPrices/);
  assert.match(r.html, /Confirm your YGOPrices account/);
  assert.match(r.html, /https:\/\/ygoprices\.io\/ygoprices-logo\.png/);
  assert.match(r.text, /Confirm your YGOPrices account/);
  assert.match(r.text, /Confirm account: https:\/\//);
});

test('recovery rendering — MTG brand', () => {
  const r = renderAuthEmail({
    brand: mtg,
    action: 'recovery',
    actionUrl: 'https://egidpsrkqvymvioidatc.supabase.co/auth/v1/verify?token=Y&type=recovery&redirect_to=https%3A%2F%2Fmtgprices.io%2Fauth%2Fcallback',
    recipientEmail: 'bob@example.com',
  });
  assert.match(r.subject, /Reset your MTGPrices password/);
  assert.match(r.html, /MTGPrices/);
  assert.match(r.text, /Reset password: https:\/\//);
});

test('email_change — to_current variant carries current-inbox copy', () => {
  const r = renderAuthEmail({
    brand: ygo,
    action: 'email_change',
    variant: 'to_current',
    actionUrl: 'https://x/v?token=A',
    recipientEmail: 'old@example.com',
  });
  assert.match(r.subject, /Confirm your YGOPrices email change/);
  assert.match(r.html, /Confirm your email change/);
});

test('email_change — to_new variant carries new-inbox copy', () => {
  const r = renderAuthEmail({
    brand: ygo,
    action: 'email_change',
    variant: 'to_new',
    actionUrl: 'https://x/v?token=B',
    recipientEmail: 'new@example.com',
  });
  assert.match(r.subject, /Confirm your new YGOPrices email/);
  assert.match(r.html, /Confirm your new email/);
});

test('neutral fallback used when brand is unknown', () => {
  const r = renderAuthEmail({
    brand: NEUTRAL_BRAND,
    action: 'signup',
    actionUrl: 'https://x/v?token=Z',
    recipientEmail: 'anon@example.com',
  });
  assert.match(r.subject, /Collector Network/);
  assert.match(r.html, /Collector Network/);
});

test('logo missing → text-only branded header (no broken <img>)', () => {
  // MTG brand has logoUrl: null in the registry.
  const r = renderAuthEmail({
    brand: mtg,
    action: 'signup',
    actionUrl: 'https://x/v?token=Q',
    recipientEmail: 'a@b.com',
  });
  assert.equal(r.html.includes('<img'), false);
  assert.match(r.html, />MTGPrices</);
});

test('no promotional content leaks into any transactional template', () => {
  for (const action of ['signup', 'recovery', 'magiclink', 'invite', 'reauthentication'] as const) {
    for (const brand of [ygo, mtg, NEUTRAL_BRAND]) {
      const r = renderAuthEmail({
        brand,
        action,
        actionUrl: 'https://x/v?token=T',
        recipientEmail: 'a@b.com',
      });
      const bag = `${r.subject}\n${r.html}\n${r.text}`.toLowerCase();
      // Fail if newsletter/marketing/promo copy sneaks in.
      for (const bad of [
        'newsletter', 'subscribe now', 'special offer', 'discount', 'sale',
        'unsubscribe', 'promotional', 'promo code',
      ]) {
        assert.equal(bag.includes(bad), false, `unexpected token '${bad}' in ${action}/${brand.siteCode}`);
      }
    }
  }
});

test('no em dashes in any rendered output', () => {
  for (const action of ['signup', 'recovery', 'magiclink', 'invite', 'reauthentication', 'email_change'] as const) {
    for (const brand of [ygo, mtg, NEUTRAL_BRAND]) {
      for (const variant of ['default', 'to_current', 'to_new'] as const) {
        const r = renderAuthEmail({
          brand,
          action,
          variant,
          actionUrl: 'https://x/v?token=T',
          recipientEmail: 'a@b.com',
        });
        const bag = `${r.subject}${r.html}${r.text}`;
        assert.equal(bag.includes('—'), false, `em dash in ${action}/${brand.siteCode}/${variant}`);
      }
    }
  }
});

test('recipient email is html-escaped in the footer', () => {
  const r = renderAuthEmail({
    brand: ygo,
    action: 'signup',
    actionUrl: 'https://x/v?token=T',
    recipientEmail: '<script>alert(1)</script>@x.io',
  });
  // The dangerous chars are escaped.
  assert.equal(r.html.includes('<script>alert(1)</script>@x.io'), false);
  assert.ok(r.html.includes('&lt;script&gt;'));
});

test('copyFor covers every action + variant deterministically', () => {
  for (const action of ['signup', 'recovery', 'magiclink', 'invite', 'reauthentication', 'email_change'] as const) {
    const c = copyFor(ygo, action);
    assert.ok(c.subject.length > 0);
    assert.ok(c.headline.length > 0);
    assert.ok(c.body.length > 0);
    assert.ok(c.cta.length > 0);
  }
});
