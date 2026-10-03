import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import {
  loadActiveProperties, backfillGscProperty, backfillGa4Property,
  syncGscProperty, syncGa4Property,
} from '@/server/google/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// One-shot historical backfill. Two modes:
//
//   Default: ?kind=gsc|ga4 [&site=<slug>]
//     Full backfill from the property's backfill_from. Walks the
//     date range in 10-day windows. Fine for the small sites.
//
//   Windowed: ?kind=gsc|ga4&site=<slug>&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//     Sync just that window. Used by scripts/backfill-pokeprices.ts
//     when the dataset is too large to fit a single 300s function.

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 401 });
  }
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') as 'gsc' | 'ga4' | null;
  const site = url.searchParams.get('site') ?? undefined;
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  if (kind !== 'gsc' && kind !== 'ga4') {
    return NextResponse.json({ ok: false, error: "kind must be 'gsc' or 'ga4'" }, { status: 400 });
  }
  const sb = createServiceRoleSupabase();
  const props = await loadActiveProperties(sb, kind, site);
  const today = new Date();
  const results: Array<Record<string, unknown>> = [];
  const errors: Array<{ property: string; error: string }> = [];

  const windowed = startDate && endDate;
  if (windowed && !site) {
    return NextResponse.json({ ok: false, error: 'windowed backfill requires site=<slug>' }, { status: 400 });
  }

  for (const p of props) {
    try {
      if (kind === 'gsc') {
        const r = windowed
          ? await syncGscProperty(sb, p, startDate!, endDate!)
          : await backfillGscProperty(sb, p, today);
        if (r.latest_date) {
          await sb.from('network_google_properties').update({
            last_sync_at: new Date().toISOString(),
            last_data_date: r.latest_date,
          }).eq('id', p.id).or(`last_data_date.is.null,last_data_date.lt.${r.latest_date}`);
          await sb.from('network_google_properties').update({
            last_sync_at: new Date().toISOString(),
          }).eq('id', p.id);
        }
        results.push({ property: p.property_id, ...r });
      } else {
        const r = windowed
          ? await syncGa4Property(sb, p, startDate!, endDate!)
          : await backfillGa4Property(sb, p, today);
        if (r.latest_date) {
          await sb.from('network_google_properties').update({
            last_sync_at: new Date().toISOString(),
            last_data_date: r.latest_date,
          }).eq('id', p.id).or(`last_data_date.is.null,last_data_date.lt.${r.latest_date}`);
          await sb.from('network_google_properties').update({
            last_sync_at: new Date().toISOString(),
          }).eq('id', p.id);
        }
        results.push({ property: p.property_id, ...r });
      }
    } catch (err) {
      errors.push({ property: p.property_id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ ok: errors.length === 0, kind, site: site ?? 'all', windowed: !!windowed, results, errors });
}
