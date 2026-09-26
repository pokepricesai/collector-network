// Supabase Send Email Hook payload types. Kept in one place so
// the renderer, handler and tests share the exact shape Supabase
// actually delivers. See the manual-setup doc for the current
// Supabase docs link.
//
// Node + Deno safe: pure types, no runtime imports.

export type EmailActionType =
  | 'signup'
  | 'recovery'
  | 'magiclink'
  | 'email_change'
  | 'invite'
  | 'reauthentication';

// The "email_data" block Supabase sends. When Secure Email Change
// is enabled AND the action is 'email_change' both token pairs
// are present. Otherwise only token + token_hash.
export interface HookEmailData {
  email_action_type: EmailActionType;
  redirect_to: string;
  site_url: string;
  token: string;
  token_hash: string;
  token_new?: string;
  token_hash_new?: string;
  token_type?: string;
}

export interface HookUser {
  id: string;
  email: string;
  new_email?: string;
  // Supabase includes more fields (phone, aal, factors etc). We
  // deliberately do not pull them through the renderer.
}

export interface HookPayload {
  user: HookUser;
  email_data: HookEmailData;
}

// Env variables required at runtime. Populated in the Deno entry
// via Deno.env.get; tests inject synthetic values.
export interface RuntimeEnv {
  RESEND_API_KEY: string;
  AUTH_EMAIL_FROM_ADDRESS: string;
  SEND_EMAIL_HOOK_SECRET: string;
}
