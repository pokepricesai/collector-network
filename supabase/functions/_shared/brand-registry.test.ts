import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  brandForHostname,
  brandForRedirectUrl,
  isKnownRedirectTarget,
  NEUTRAL_BRAND,
} from './brand-registry.ts';

test('hostname → YGO branding on canonical + www', () => {
  assert.equal(brandForHostname('ygoprices.io').siteCode, 'ygo');
  assert.equal(brandForHostname('www.ygoprices.io').siteCode, 'ygo');
  assert.equal(brandForHostname('YGOPRICES.IO').siteCode, 'ygo');
});

test('hostname → MTG branding on canonical + www', () => {
  assert.equal(brandForHostname('mtgprices.io').siteCode, 'mtg');
  assert.equal(brandForHostname('www.mtgprices.io').siteCode, 'mtg');
});

test('hostname → PokePrices branding on canonical + www', () => {
  assert.equal(brandForHostname('pokeprices.io').siteCode, 'pokemon');
  assert.equal(brandForHostname('www.pokeprices.io').siteCode, 'pokemon');
});

test('unknown hostname → neutral fallback (never guess a brand)', () => {
  assert.equal(brandForHostname('attacker.example').siteCode, 'network');
  assert.equal(brandForHostname('ygoprices.attacker.example').siteCode, 'network');
  assert.equal(brandForHostname('').siteCode, 'network');
});

test('inactive-launch hosts (onepiece/lorcana) fall back to neutral', () => {
  // Registry deliberately omits them until domains are final.
  assert.equal(brandForHostname('onepieceprices.io').siteCode, 'network');
  assert.equal(brandForHostname('lorcana.io').siteCode, 'network');
});

test('brandForRedirectUrl parses http(s) URLs safely', () => {
  assert.equal(brandForRedirectUrl('https://ygoprices.io/auth/callback').siteCode, 'ygo');
  assert.equal(brandForRedirectUrl('https://mtgprices.io/auth/callback?returnTo=%2Fcards').siteCode, 'mtg');
  assert.equal(brandForRedirectUrl('http://localhost:3001/auth/callback').siteCode, 'network');
});

test('brandForRedirectUrl rejects non-http(s) protocols (no javascript:, no data:)', () => {
  assert.equal(brandForRedirectUrl('javascript:alert(1)').siteCode, 'network');
  assert.equal(brandForRedirectUrl('data:text/html,<script>').siteCode, 'network');
  assert.equal(brandForRedirectUrl('file:///etc/passwd').siteCode, 'network');
});

test('brandForRedirectUrl handles null/undefined/malformed', () => {
  assert.equal(brandForRedirectUrl(null).siteCode, 'network');
  assert.equal(brandForRedirectUrl(undefined).siteCode, 'network');
  assert.equal(brandForRedirectUrl('not a url').siteCode, 'network');
  assert.equal(brandForRedirectUrl('').siteCode, 'network');
});

test('isKnownRedirectTarget is true only for allowlisted hosts', () => {
  assert.equal(isKnownRedirectTarget('https://ygoprices.io/x'), true);
  assert.equal(isKnownRedirectTarget('https://www.mtgprices.io/x'), true);
  assert.equal(isKnownRedirectTarget('https://attacker.example/x'), false);
  assert.equal(isKnownRedirectTarget('http://localhost:3001/x'), false);
  assert.equal(isKnownRedirectTarget(null), false);
});

test('NEUTRAL_BRAND never leaks a specific brand name', () => {
  assert.equal(NEUTRAL_BRAND.brandName, 'Collector Network');
  assert.equal(NEUTRAL_BRAND.siteCode, 'network');
  assert.equal(NEUTRAL_BRAND.hostnames.length, 0);
});
