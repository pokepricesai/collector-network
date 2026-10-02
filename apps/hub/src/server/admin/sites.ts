import 'server-only';

// Load the canonical five-site registry. Everything site-scoped in
// the OS reads from this — do NOT hardcode site metadata in UI.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface NetworkSite {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  canonicalUrl: string;
  productionApp: string | null;
  logoPath: string | null;
  status: 'active' | 'parked' | 'planned' | 'archived';
}

const SITE_ORDER = ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'] as const;

function sortByCanonical(a: NetworkSite, b: NetworkSite): number {
  const ai = (SITE_ORDER as readonly string[]).indexOf(a.slug);
  const bi = (SITE_ORDER as readonly string[]).indexOf(b.slug);
  if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

export async function listNetworkSites(sb: SupabaseClient): Promise<NetworkSite[]> {
  const { data, error } = await sb
    .from('network_sites')
    .select('id, slug, name, short_name, canonical_url, production_app, logo_path, status');
  if (error) throw new Error(`[hub/admin] listNetworkSites: ${error.message}`);
  const rows = ((data ?? []) as Array<{
    id: string; slug: string; name: string; short_name: string;
    canonical_url: string; production_app: string | null;
    logo_path: string | null; status: NetworkSite['status'];
  }>).map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    shortName: r.short_name,
    canonicalUrl: r.canonical_url,
    productionApp: r.production_app,
    logoPath: r.logo_path,
    status: r.status,
  }));
  return rows.sort(sortByCanonical);
}

export async function getNetworkSite(
  sb: SupabaseClient,
  slug: string,
): Promise<NetworkSite | null> {
  const { data, error } = await sb
    .from('network_sites')
    .select('id, slug, name, short_name, canonical_url, production_app, logo_path, status')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`[hub/admin] getNetworkSite ${slug}: ${error.message}`);
  if (!data) return null;
  const r = data as {
    id: string; slug: string; name: string; short_name: string;
    canonical_url: string; production_app: string | null;
    logo_path: string | null; status: NetworkSite['status'];
  };
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    shortName: r.short_name,
    canonicalUrl: r.canonical_url,
    productionApp: r.production_app,
    logoPath: r.logo_path,
    status: r.status,
  };
}
