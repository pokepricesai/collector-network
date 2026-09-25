// Server wrapper — resolves auth state so the button paints in
// its logged-in / logged-out variant on first render.

import { getCurrentUser } from '@collector-network/auth';
import { AddToDeck } from './AddToDeck';

interface Props {
  currentPathname: string;
  cardName: string;
  tcgPrintingId?: string;
  extraOnly?: boolean;
}

export async function AddToDeckMount(props: Props) {
  const user = await getCurrentUser();
  return (
    <AddToDeck
      isSignedIn={!!user}
      currentPathname={props.currentPathname}
      cardName={props.cardName}
      tcgPrintingId={props.tcgPrintingId}
      extraOnly={props.extraOnly}
    />
  );
}
