import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import {
  loadActiveProperties, backfillGscProperty, backfillGa4Property,
} from '@/server/google/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// One-shot historical backfill — intended for manual trigger (not cron).
// `kind=gsc|ga4` and optional `site=<slug>` to scope. Response includes
// per-property row counts so the operator can see progress even when
// multiple runs are needed to backfill a large (PokePrices-sized)
// window.

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 401 });
  }
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') as 'gsc' | 'ga4' | null;
  const site = url.searchParams.get('site') ?? undefined;
  if (kind !== 'gsc' && kind !== 'ga4') {
    return NextResponse.json({ ok: false, error: "kind must be 'gsc' or 'ga4'" }, { status: 400 });
  }
  const sb = createServiceRoleSupabase();
  const props = await loadActiveProperties(sb, kind, site);
  const today = new Date();
  const results: Array<Record<string, unknown>> = [];
  const errors: Array<{ property: string; error: string }> = [];
  for (const p of props) {
    try {
      if (kind === 'gsc') {
        const r = await backfillGscProperty(sb, p, today);
        if (r.latest_date) {
          await sb.from('network_google_properties').update({
            last_sync_at: new Date().toISOString(),
            last_data_date: r.latest_date,
          }).eq('id', p.id);
        }
        results.push({ property: p.property_id, ...r });
      } else {
        const r = await backfillGa4Property(sb, p, today);
        if (r.latest_date) {
          await sb.from('network_google_properties').update({
            last_sync_at: new Date().toISOString(),
            last_data_date: r.latest_date,
          }).eq('id', p.id);
        }
        results.push({ property: p.property_id, ...r });
      }
    } catch (err) {
      errors.push({ property: p.property_id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ ok: errors.length === 0, kind, site: site ?? 'all', results, errors });
}
