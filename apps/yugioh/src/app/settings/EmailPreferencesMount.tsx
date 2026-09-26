'use client';

// Client shim that constructs the browser Supabase client and
// hands it to the shared EmailPreferences component. Kept here
// so the shared component stays pure and testable without
// pulling site-specific factories into the shared package.

import { useMemo } from 'react';
import { createBrowserSupabase } from '@collector-network/auth';
import {
  EmailPreferences,
  type EmailPreferencesProps,
} from '@collector-network/network-ui';

type ForwardedProps = Omit<EmailPreferencesProps, 'supabase'>;

export function EmailPreferencesMount(props: ForwardedProps) {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  return <EmailPreferences {...props} supabase={supabase} />;
}
