// Supabase Send Email Hook → Resend transactional bridge.
//
// Deployed with `--no-verify-jwt` because Supabase's hook system
// signs each call with Standard Webhooks (see verify-webhook.ts)
// rather than a Bearer JWT.
//
// All business logic lives in ../_shared/handle-request.ts so the
// same code is exercised by node --test.
//
// Environment (Supabase secrets, never in-repo):
//   RESEND_API_KEY
//   AUTH_EMAIL_FROM_ADDRESS
//   SEND_EMAIL_HOOK_SECRET     (base64 `v1,whsec_...` value)

import { buildResponse, handleHookRequest } from '../_shared/handle-request.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Deno: any;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  const rawBody = await req.text();
  const env = {
    RESEND_API_KEY: Deno.env.get('RESEND_API_KEY') ?? '',
    AUTH_EMAIL_FROM_ADDRESS: Deno.env.get('AUTH_EMAIL_FROM_ADDRESS') ?? '',
    SEND_EMAIL_HOOK_SECRET: Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '',
  };
  const out = await handleHookRequest({
    rawBody,
    headers: {
      id: req.headers.get('webhook-id'),
      timestamp: req.headers.get('webhook-timestamp'),
      signature: req.headers.get('webhook-signature'),
    },
    env,
  });
  // Minimal server-side observability: log tag-only summary. No
  // tokens, no email bodies, no provider response bodies.
  const brief = {
    status: out.status,
    sent: out.sent,
    ...(out.errorTag ? { errorTag: out.errorTag } : {}),
  };
  console.log(JSON.stringify(brief));
  return buildResponse(out);
});
