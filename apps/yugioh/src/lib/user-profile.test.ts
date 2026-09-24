import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProfilePatch,
  isAvatarKey,
  isCurrency,
  isGrader,
  isPriceDisplay,
  readYgoProfile,
  sanitiseDisplayName,
} from './user-profile';

test('validators accept known values and reject junk', () => {
  assert.equal(isAvatarKey('dragon'), true);
  assert.equal(isAvatarKey('nope'), false);
  assert.equal(isAvatarKey(42), false);
  assert.equal(isCurrency('USD'), true);
  assert.equal(isCurrency('CHF'), false);
  assert.equal(isPriceDisplay('raw-and-graded'), true);
  assert.equal(isPriceDisplay('raw+graded'), false);
  assert.equal(isGrader('psa'), true);
  assert.equal(isGrader('PSA'), false); // case-sensitive by design
});

test('sanitiseDisplayName trims + caps at 60', () => {
  assert.equal(sanitiseDisplayName('   Duel   Master   '), 'Duel Master');
  const long = 'A'.repeat(200);
  assert.equal(sanitiseDisplayName(long).length, 60);
});

test('buildProfilePatch only writes provided fields', () => {
  const patch = buildProfilePatch({ displayName: 'Blue-Eyes fan' });
  assert.deepEqual(patch, {
    ygo: { profile: { display_name: 'Blue-Eyes fan' }, preferences: {} },
  });
});

test('buildProfilePatch rejects invalid values silently', () => {
  const patch = buildProfilePatch({
    displayName: 'x',
    avatarKey: 'not-a-key' as never,
    preferredCurrency: 'CHF' as never,
    priceDisplay: 'wrong' as never,
    preferredGrader: 'PSA' as never,
  });
  assert.deepEqual(patch, {
    ygo: { profile: { display_name: 'x' }, preferences: {} },
  });
});

test('readYgoProfile falls back through metadata → email → default', () => {
  // Only email present
  const emailOnly = readYgoProfile({
    id: 'u1',
    email: 'alice@example.com',
    user_metadata: {},
    // Minimal user shape — fields the reader touches:
    // (test cast; real supabase User has many more)
  } as never);
  assert.equal(emailOnly.displayName, 'alice');
  assert.equal(emailOnly.avatarKey, 'dragon');
  assert.equal(emailOnly.preferredCurrency, 'USD');
});

test('readYgoProfile uses ygo.profile when set', () => {
  const withYgo = readYgoProfile({
    id: 'u1',
    email: 'alice@example.com',
    user_metadata: {
      ygo: {
        profile: { display_name: 'Alice B.', avatar_key: 'spellcaster' },
        preferences: {
          preferred_currency: 'EUR',
          price_display: 'graded-only',
          preferred_grader: 'psa',
        },
      },
    },
  } as never);
  assert.equal(withYgo.displayName, 'Alice B.');
  assert.equal(withYgo.avatarKey, 'spellcaster');
  assert.equal(withYgo.preferredCurrency, 'EUR');
  assert.equal(withYgo.priceDisplay, 'graded-only');
  assert.equal(withYgo.preferredGrader, 'psa');
});

test('readYgoProfile ignores malformed ygo.* values', () => {
  const bad = readYgoProfile({
    id: 'u1',
    email: 'alice@example.com',
    user_metadata: {
      ygo: {
        profile: { avatar_key: 'not-a-key' },
        preferences: { preferred_currency: 'CHF', price_display: 42 },
      },
    },
  } as never);
  // Falls back to defaults
  assert.equal(bad.avatarKey, 'dragon');
  assert.equal(bad.preferredCurrency, 'USD');
  assert.equal(bad.priceDisplay, 'raw-and-graded');
});
