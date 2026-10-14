import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceRoleSupabase } from '@/server/admin/service-role';
import { verifyUnsubscribeToken } from '@collector-network/email';
import { getUnsubscribeSecret } from '@/server/emails/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// RFC 8058 one-click unsubscribe:
//   - List-Unsubscribe-Post header asks the recipient's mail client
//     to POST to this URL with no body.
//   - We honour that silently (no interactive confirmation).
//   - GET lands on the public /unsubscribe page which also calls POST
//     via a form so a human click also unsubscribes.

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  // Legacy GET-based unsubscribe link (older email clients). Equivalent
  // to one-click; we redirect to the public confirmation page.
  const res = await handle(req);
  if (res.status === 200) {
    const base = new URL(req.url);
    base.pathname = '/unsubscribe';
    return NextResponse.redirect(base, { status: 302 });
  }
  return res;
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';
  if (!token) return NextResponse.json({ ok: false, error: 'missing_token' }, { status: 400 });

  const secret = getUnsubscribeSecret();
  const payload = verifyUnsubscribeToken(secret, token);
  if (!payload) return NextResponse.json({ ok: false, error: 'bad_token' }, { status: 400 });

  const admin = createServiceRoleSupabase();
  const scopeCode = payload.kind === 'network' ? 'network' : payload.siteCode;

  // Write explicit opt-out to collector_marketing_preferences via the
  // existing RPC if available. If the RPC name differs, fall back to a
  // direct upsert.
  const rpcName = payload.kind === 'network'
    ? 'collector_set_network_marketing_preference'
    : 'collector_set_site_marketing_preference';
  const { error: rpcErr } = await admin.rpc(rpcName as string, {
    p_user_id: payload.userId,
    p_scope_code: scopeCode,
    p_consented: false,
    p_source: 'email_unsubscribe',
  } as unknown as Record<string, unknown>);

  if (rpcErr) {
    // Fallback: direct upsert.
    try {
      await admin
        .from('collector_marketing_preferences')
        .upsert({
          user_id: payload.userId,
          scope_type: payload.kind,
          scope_code: scopeCode,
          consented: false,
          consented_at: new Date().toISOString(),
          source: 'email_unsubscribe',
        }, { onConflict: 'user_id,scope_code' });
    } catch {
      // best effort
    }
  }

  // Also log a suppression (marketing_newsletter) so any legacy
  // category check short-circuits.
  try {
    const { data: contact } = await admin
      .from('email_contacts')
      .select('id')
      .eq('user_id', payload.userId)
      .maybeSingle();
    const contactId = contact && typeof contact === 'object' && 'id' in contact
      ? (contact as { id: string }).id
      : null;
    if (contactId) {
      await admin
        .from('email_suppressions')
        .insert({
          contact_id: contactId,
          reason: 'manual_unsubscribe',
          category: 'marketing_newsletter',
          source: `cn03_${payload.kind}_${scopeCode}`,
        });
    }
  } catch {
    /* best effort */
  }

  return NextResponse.json({ ok: true, kind: payload.kind, scope: scopeCode });
}
