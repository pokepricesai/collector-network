// @collector-network/network-ui
//
// Shared UI primitives used across every Collector Network site.
// Currently: the EmailPreferences component (Slice CN-B). Each
// site imports and configures with its own site code + Supabase
// client; the display copy, tri-state interpretation and RPC
// wiring stay in one place so wording never drifts.

export { EmailPreferences } from './EmailPreferences';
export type { EmailPreferencesProps } from './EmailPreferences';
export {
  interpretNetworkState,
  interpretSiteState,
  labelForState,
} from './email-preferences-state';
export type { TriState } from './email-preferences-state';
