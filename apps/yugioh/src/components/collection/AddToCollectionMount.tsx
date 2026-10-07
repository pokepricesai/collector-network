'use client';

// Client wrapper that resolves auth state via the shared
// useYgoSession hook and renders the underlying <AddToCollection />
// client component. Previously this was an async server component
// that called getCurrentUser() -> cookies(), which forced every
// public card page into Dynamic Rendering. Lifting the auth read
// client-side is what unlocks the Full Route Cache on /card/[slug]
// and /card/[slug]/printing/* (YGO P0-5).
//
// PRESENTATION ONLY. Mutations in src/app/collection/actions.ts
// re-check the session server-side via Supabase RLS. The
// `isSignedIn` prop below is a UX gate (shows the sign-in CTA when
// anonymous), never an authorization check.
//
// Hydration shape: first render = anonymous (status === 'loading'
// renders the same chrome as 'anon' because the signed-out variant
// of <AddToCollection /> is the public shell). Server HTML always
// shows the signed-out CTA; signed-in users see it for one tick
// before the real button paints.

import { useYgoSession } from '../hooks/useYgoSession';
import {
  AddToCollection,
  type PrintingOption,
} from './AddToCollection';

interface Props {
  currentPathname: string;
  cardId: string;
  cardName: string;
  fixedPrinting?: PrintingOption;
  availablePrintings?: PrintingOption[];
  variant?: 'primary' | 'ghost';
}

export function AddToCollectionMount(props: Props) {
  const { status } = useYgoSession();
  const isSignedIn = status === 'signed-in';
  return (
    <AddToCollection
      isSignedIn={isSignedIn}
      currentPathname={props.currentPathname}
      cardId={props.cardId}
      cardName={props.cardName}
      fixedPrinting={props.fixedPrinting}
      availablePrintings={props.availablePrintings}
      variant={props.variant}
    />
  );
}
