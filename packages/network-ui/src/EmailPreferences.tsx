'use client';

// Shared Email Preferences component used by every Collector
// Network site. Renders two independent toggles — the current
// site's newsletter + the network-wide newsletter — with
// tri-state awareness ("no preference recorded" is distinct
// from "unsubscribed").
//
// Sites plug in via props:
//   siteCode: 'ygo' | 'mtg' | 'pokemon' | 'onepiece' | 'lorcana'
//   supabase: their client Supabase client
//   source:   'settings' | 'preference_center' (drives audit log)
//
// The component reads current preferences on mount, exposes the
// two toggles, and calls the CN-A/CN-B write RPCs on change. No
// direct table writes. Consent version is DB-owned.

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getMarketingPreferences,
  setNetworkMarketingPreference,
  setSiteMarketingPreference,
  type MarketingPreference,
  type SiteCode,
  type UserConsentSource,
} from '@collector-network/auth';
import {
  copyForSite,
  NETWORK_CONSENT_COPY,
  type SiteConsentCode,
} from '@collector-network/network-config';
import {
  interpretNetworkState,
  interpretSiteState,
  labelForState,
  type TriState,
} from './email-preferences-state';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'saving'; scope: 'site' | 'network' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

export interface EmailPreferencesProps {
  supabase: SupabaseClient;
  siteCode: SiteConsentCode;
  // Which trusted user path is invoking the change. The DB will
  // reject anything other than 'settings' / 'preference_center'.
  source: UserConsentSource;
  // Optional heading override.
  heading?: string;
  // Optional intro copy override.
  introText?: string;
}

export function EmailPreferences(props: EmailPreferencesProps) {
  const site = copyForSite(props.siteCode);
  const [prefs, setPrefs] = useState<MarketingPreference[] | null>(null);
  const [state, setState] = useState<SaveState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    const r = await getMarketingPreferences(props.supabase);
    if (!r.ok) {
      setState({ kind: 'error', message: r.error ?? 'Could not load preferences' });
      return;
    }
    setPrefs(r.value);
    setState({ kind: 'idle' });
  }, [props.supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const siteState: TriState = prefs
    ? interpretSiteState(prefs, props.siteCode as SiteCode)
    : 'no-preference';
  const networkState: TriState = prefs
    ? interpretNetworkState(prefs)
    : 'no-preference';

  async function toggle(scope: 'site' | 'network', next: boolean) {
    setState({ kind: 'saving', scope });
    const r =
      scope === 'site'
        ? await setSiteMarketingPreference(props.supabase, {
            siteCode: props.siteCode as SiteCode,
            optIn: next,
            source: props.source,
          })
        : await setNetworkMarketingPreference(props.supabase, {
            optIn: next,
            source: props.source,
          });
    if (!r.ok) {
      setState({ kind: 'error', message: r.error ?? 'Could not save' });
      return;
    }
    await load();
    setState({ kind: 'saved' });
  }

  const heading = props.heading ?? 'Email preferences';
  const intro =
    props.introText ??
    'Choose which emails you want to receive. Your account will continue to work even if you unsubscribe from all marketing emails.';

  return (
    <section className="cn-email-prefs" aria-labelledby="cn-email-prefs-heading">
      <h2 id="cn-email-prefs-heading" className="cn-email-prefs__title">
        {heading}
      </h2>
      <p className="cn-email-prefs__intro">{intro}</p>

      {state.kind === 'loading' && (
        <p className="cn-email-prefs__status" role="status">
          Loading your current preferences...
        </p>
      )}

      {state.kind !== 'loading' && (
        <>
          <PreferenceRow
            id="cn-pref-site"
            label={site.label}
            description={site.description}
            state={siteState}
            busy={state.kind === 'saving' && state.scope === 'site'}
            onChange={(next) => toggle('site', next)}
          />
          <PreferenceRow
            id="cn-pref-network"
            label={NETWORK_CONSENT_COPY.label}
            description={NETWORK_CONSENT_COPY.description}
            state={networkState}
            busy={state.kind === 'saving' && state.scope === 'network'}
            onChange={(next) => toggle('network', next)}
          />
        </>
      )}

      {state.kind === 'saved' && (
        <p className="cn-email-prefs__status cn-email-prefs__status--ok" role="status">
          Saved
        </p>
      )}
      {state.kind === 'error' && (
        <p className="cn-email-prefs__status cn-email-prefs__status--err" role="alert">
          {state.message}
        </p>
      )}
    </section>
  );
}

function PreferenceRow(props: {
  id: string;
  label: string;
  description: string;
  state: TriState;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  // Checkbox reflects the CURRENT recorded preference. When the
  // tri-state is 'no-preference' the checkbox is unchecked but
  // labelled honestly as "No preference recorded" so the user
  // knows they have not saved anything either way.
  const checked = props.state === 'opted-in';
  return (
    <div className="cn-email-prefs__row">
      <label htmlFor={props.id} className="cn-email-prefs__labelRow">
        <input
          id={props.id}
          type="checkbox"
          checked={checked}
          disabled={props.busy}
          onChange={(e) => props.onChange(e.target.checked)}
          className="cn-email-prefs__checkbox"
        />
        <span className="cn-email-prefs__labelText">
          <span className="cn-email-prefs__label">{props.label}</span>
          <span className="cn-email-prefs__description">{props.description}</span>
          <span
            className={`cn-email-prefs__state cn-email-prefs__state--${props.state}`}
          >
            {labelForState(props.state)}
          </span>
        </span>
      </label>
    </div>
  );
}
