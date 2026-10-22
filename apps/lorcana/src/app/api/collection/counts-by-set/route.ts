import 'server-only';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@collector-network/auth';
import { listCardIdsBySet, listSetsWithCounts } from '@/server/browse';
import { getOwnedCardIdSetForCurrentUser } from '@/server/collection-state';

// Per-user collection-completion counts, one entry per set code.
// Called by apps/lorcana/src/components/browse/BrowseGridClient.tsx
// AFTER it has resolved an authenticated supabase session on mount.
//
// CN-COST-06: this exists because /browse is ISR'd. The server
// shell renders ownedCount = 0 for every set so the cached HTML
// never carries one user's ownership data. The client island calls
// this endpoint only when supabase.auth confirms a session, and
// merges the result into the already-rendered SetsGrid.
//
// Response headers:
//   Cache-Control: private, no-store   — never shared across
//   users and never cached at the CDN. Enforced regardless of
//   signed-in / anon.
//
// Shape:
//   signedIn=false, countsByCode={}   — anonymous caller
//   signedIn=true,  countsByCode={lc001: 42, …}  — authenticated

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  const noStoreHeaders = { 'Cache-Control': 'private, no-store' } as const;

  if (!user) {
    return NextResponse.json(
      { signedIn: false, countsByCode: {} },
      { headers: noStoreHeaders },
    );
  }

  const [sets, owned, cardIdsBySet] = await Promise.all([
    listSetsWithCounts(),
    getOwnedCardIdSetForCurrentUser(),
    listCardIdsBySet(),
  ]);

  const countsByCode: Record<string, number> = {};
  for (const s of sets) {
    let n = 0;
    for (const cardId of cardIdsBySet[s.set.id] ?? []) {
      if (owned.has(cardId)) n++;
    }
    countsByCode[s.set.code] = n;
  }

  return NextResponse.json(
    { signedIn: true, countsByCode },
    { headers: noStoreHeaders },
  );
}
