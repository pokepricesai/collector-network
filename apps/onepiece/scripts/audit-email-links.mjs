#!/usr/bin/env node
// Verify Supabase auth email link redirect targets for OnePiecePrices.
// Generates a signup link and a password-recovery link via the admin
// API, prints the action_link + redirect_to that Supabase would embed
// in the outgoing email, and confirms the URLs point at
// onepieceprices.io (never a preview/vercel.app/localhost).
//
// Does NOT actually send email. Does NOT touch existing users.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const MTG_ENV = readFileSync('C:/Users/lukep/OneDrive/Desktop/mtgprices-web/.env.local', 'utf8');
function envFrom(text, key) {
  const m = new RegExp('^' + key + '=(.*)$', 'm').exec(text);
  return m ? m[1].replace(/^"|"$/g, '') : '';
}
const URL_ = envFrom(MTG_ENV, 'NEXT_PUBLIC_SUPABASE_URL');
const KEY = envFrom(MTG_ENV, 'SUPABASE_SERVICE_ROLE_KEY');
const s = createClient(URL_, KEY, { auth: { persistSession: false } });

const stamp = Date.now();
const email1 = `op-recovery-${stamp}@ygoprices.io`;
const email2 = `op-signup-${stamp}@ygoprices.io`;
const password = 'X-' + randomUUID();

function checkHost(url, label) {
  try {
    const u = new URL(url);
    const good = u.hostname === 'onepieceprices.io' || u.host === 'onepieceprices.io';
    console.log(`  ${label} redirect_to host: ${u.hostname} ${good ? '✓' : '✗ NOT onepieceprices.io'}`);
    if (u.hostname.includes('localhost') || u.hostname.includes('vercel.app') || u.hostname.includes('preview')) {
      console.log(`  ${label} LEAK: ${u.hostname}`);
    }
    return good;
  } catch {
    console.log(`  ${label} invalid URL: ${url}`);
    return false;
  }
}

const created = [];
try {
  // 1. Create user for recovery test.
  const { data: u1, error: e1 } = await s.auth.admin.createUser({
    email: email1, password, email_confirm: true,
  });
  if (e1) { console.error('createUser recovery target:', e1.message); process.exit(1); }
  created.push(u1.user.id);

  // 2. Recovery link.
  const { data: rec, error: e2 } = await s.auth.admin.generateLink({
    type: 'recovery',
    email: email1,
    options: { redirectTo: 'https://onepieceprices.io/auth/callback?next=/settings' },
  });
  if (e2) { console.error('generateLink recovery:', e2.message); process.exit(1); }
  console.log('=== password recovery ===');
  console.log('  email_target:', email1);
  console.log('  action_link:', rec.properties.action_link);
  console.log('  redirect_to:', rec.properties.redirect_to);
  const recOk = checkHost(rec.properties.redirect_to, 'recovery');

  // 3. Signup link (new user).
  const { data: sig, error: e3 } = await s.auth.admin.generateLink({
    type: 'signup',
    email: email2,
    password,
    options: { redirectTo: 'https://onepieceprices.io/auth/callback' },
  });
  if (e3) { console.error('generateLink signup:', e3.message); process.exit(1); }
  if (sig.user) created.push(sig.user.id);
  console.log('=== signup confirmation ===');
  console.log('  email_target:', email2);
  console.log('  action_link:', sig.properties.action_link);
  console.log('  redirect_to:', sig.properties.redirect_to);
  const sigOk = checkHost(sig.properties.redirect_to, 'signup');

  console.log('=== summary ===');
  console.log('  recovery redirect points at onepieceprices.io:', recOk ? 'YES' : 'NO');
  console.log('  signup   redirect points at onepieceprices.io:', sigOk ? 'YES' : 'NO');
  if (!recOk || !sigOk) process.exitCode = 1;
} finally {
  for (const uid of created) {
    const { error } = await s.auth.admin.deleteUser(uid);
    if (error) console.error(`cleanup ${uid}: ${error.message}`);
    else console.log(`  - deleted user ${uid}`);
  }
}
