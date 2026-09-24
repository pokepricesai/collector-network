import type { User } from '@supabase/supabase-js';

// A network user is a plain Supabase auth user. Sites layer their
// own per-site profile / preferences on top (e.g. YGO reads
// user_metadata under a `ygo` namespace).
export type CollectorNetworkUser = User;
