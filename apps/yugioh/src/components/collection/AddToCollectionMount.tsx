// Small server wrapper that resolves auth state and renders the
// client AddToCollection button. Kept separate from the client
// component so pages don't need to duplicate the "am I signed in?"
// check + returnTo assembly.

import { getCurrentUser } from '@collector-network/auth';
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

export async function AddToCollectionMount(props: Props) {
  const user = await getCurrentUser();
  return (
    <AddToCollection
      isSignedIn={!!user}
      currentPathname={props.currentPathname}
      cardId={props.cardId}
      cardName={props.cardName}
      fixedPrinting={props.fixedPrinting}
      availablePrintings={props.availablePrintings}
      variant={props.variant}
    />
  );
}
