// Server wrapper for WatchButton. Reads the auth state + current
// watch status for the target printing so the button paints in the
// correct state on first render (no client-side "is watched?" flicker).

import { getCurrentUser } from '@collector-network/auth';
import { isWatchingPrinting } from '../../server/watchlist';
import { WatchButton, type PrintingOption } from './WatchButton';

interface Props {
  currentPathname: string;
  cardId: string;
  cardName: string;
  fixedPrinting?: PrintingOption;
  availablePrintings?: PrintingOption[];
}

export async function WatchButtonMount(props: Props) {
  const user = await getCurrentUser();
  let initiallyWatchingId: string | null = null;
  if (user && props.fixedPrinting) {
    const r = await isWatchingPrinting(props.fixedPrinting.id);
    if (r.ok && r.value) initiallyWatchingId = props.fixedPrinting.id;
  }
  return (
    <WatchButton
      isSignedIn={!!user}
      currentPathname={props.currentPathname}
      cardId={props.cardId}
      cardName={props.cardName}
      fixedPrinting={props.fixedPrinting}
      availablePrintings={props.availablePrintings}
      initiallyWatchingId={initiallyWatchingId}
    />
  );
}
