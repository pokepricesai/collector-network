// Server-only helper: read the Vercel edge-provided country ISO code
// off the request headers. Used ONLY for soft UX routing — picking a
// regional eBay marketplace. Never for geolocation storage, auth
// gating, personalisation, or affiliate attribution integrity.
//
// Returns null when the header is absent (local dev, non-Vercel
// environments, or Vercel edge configurations that strip it).

import 'server-only';
import { headers } from 'next/headers';

export async function getRequestCountry(): Promise<string | null> {
  const h = await headers();
  const raw =
    h.get('x-vercel-ip-country') ??
    h.get('cf-ipcountry') ??
    null;
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  //  Reject obvious garbage. ISO country codes are 2 letters.
  if (trimmed.length !== 2 || !/^[A-Z]{2}$/.test(trimmed)) return null;
  return trimmed;
}
