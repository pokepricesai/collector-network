'use client';

// Client wrapper that resolves auth state via the shared
// useYgoSession hook. Previously an async server component that
// called getCurrentUser() -> cookies(), which forced every public
// card page into Dynamic Rendering. See YGO P0-5.
//
// PRESENTATION ONLY. Deck mutations in
// src/app/decks/add-to-deck-action.ts and
// src/app/decks/actions.ts re-check the session server-side via
// Supabase RLS. The `isSignedIn` prop below is a UX gate (shows
// the sign-in CTA when anonymous), never an authorization check.

import { useYgoSession } from '../hooks/useYgoSession';
import { AddToDeck } from './AddToDeck';

interface Props {
  currentPathname: string;
  cardName: string;
  tcgPrintingId?: string;
  extraOnly?: boolean;
}

export function AddToDeckMount(props: Props) {
  const { status } = useYgoSession();
  const isSignedIn = status === 'signed-in';
  return (
    <AddToDeck
      isSignedIn={isSignedIn}
      currentPathname={props.currentPathname}
      cardName={props.cardName}
      tcgPrintingId={props.tcgPrintingId}
      extraOnly={props.extraOnly}
    />
  );
}
