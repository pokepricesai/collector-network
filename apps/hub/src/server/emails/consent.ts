import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BrandSiteCode } from '@collector-network/email';

// Decide whether a given (user, site, category) is allowed to send.
// Order of truth (service-role read, all tables in shared Supabase):
//   1. collector_marketing_preferences: explicit opt-out for the
//      (user, scope) wins. Scope is site_code for site categories,
//      'network' for network-wide marketing.
//   2. email_suppressions on the user's email_contacts row: global
//      hard-bounce / complaint / manual_unsubscribe blocks all
//      marketing categories.
// Transactional (welcome counts as transactional in UK/EU: first-
// time account notification). Onboarding + weekly_report are
// marketing; require active consent OR a legitimate interest basis
// per the current PokePrices rules.
//
// For CN-03 MVP: onboarding + weekly are gated on absence of
// opt-out (i.e. we send to active members unless they said no).
// We DO NOT backfill marketing consent for historical users; the
// scheduler only enqueues for first_authenticated_at >= cutoff.

export interface ConsentCheckInput {
  userId: string;
  siteCode: BrandSiteCode;
  category: 'transactional' | 'onboarding' | 'weekly_report';
  recipientEmail: string;
}

export interface ConsentDecision {
  allowed: boolean;
  reason?: string;
}

export async function checkConsent(
  admin: SupabaseClient,
  input: ConsentCheckInput,
): Promise<ConsentDecision> {
  const { userId, siteCode, category, recipientEmail } = input;

  // 1. Global suppression on this email address.
  const normalized = recipientEmail.trim().toLowerCase();
  const { data: contact } = await admin
    .from('email_contacts')
    .select('id')
    .eq('email_normalized', normalized)
    .maybeSingle();

  if (contact && typeof contact === 'object' && 'id' in contact && (contact as { id: string }).id) {
    const { data: suppressions } = await admin
      .from('email_suppressions')
      .select('id, reason, category')
      .eq('contact_id', (contact as { id: string }).id)
      .is('lifted_at', null)
      .limit(5);
    if (suppressions && Array.isArray(suppressions)) {
      for (const row of suppressions as { reason: string; category: string | null }[]) {
        if (row.category == null) {
          // Global suppression blocks everything except hard
          // transactional (we never try to override a hard bounce).
          return { allowed: false, reason: `suppressed_global_${row.reason}` };
        }
        if (category !== 'transactional' && (row.category === category || row.category === 'marketing_newsletter')) {
          return { allowed: false, reason: `suppressed_${row.category}_${row.reason}` };
        }
      }
    }
  }

  // 2. Explicit opt-out in collector_marketing_preferences.
  if (category !== 'transactional') {
    const scopesToCheck = ['network', siteCode];
    const { data: prefs } = await admin
      .from('collector_marketing_preferences')
      .select('scope_type,scope_code,consented')
      .eq('user_id', userId);
    if (prefs && Array.isArray(prefs)) {
      for (const row of prefs as { scope_type?: string; scope_code?: string | null; consented: boolean }[]) {
        // Different schemas across CN-A/CN-B have used scope_code
        // or (scope_type,scope_code). Be permissive.
        const key = row.scope_code ?? row.scope_type ?? '';
        if (!key) continue;
        if (!scopesToCheck.includes(key)) continue;
        if (row.consented === false) {
          return { allowed: false, reason: `opt_out_${key}` };
        }
      }
    }
  }

  return { allowed: true };
}
