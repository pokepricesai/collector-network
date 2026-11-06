import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TcgReleaseRow, Tcg, Language, ProductType } from './types';

// CN-05 Growth Intelligence · Automated release ingestion.
//
// Two reliable sources identified after real-world probing:
//
//   * Scryfall /sets (MTG) — permissive, documented, returns
//     released_at as ISO date on confirmed releases. Preferred
//     over any Wizards HTML scrape.
//
//   * ygoprodeck /cardsets (YGO) — community-maintained
//     mirror of Konami release data with tcg_date. Not an
//     official publisher feed but reliable in practice for
//     English releases.
//
// Pokemon EN/JP, One Piece, Lorcana have NO permissive feed that
// discloses upcoming releases. pokemontcg.io ingests sets AFTER
// they release, so it cannot inform the operator about
// forthcoming ones. These remain manual.
//
// Design principles:
//   * verification_mode='automated' on ingested rows so the UI
//     can distinguish them from manual-curated rows.
//   * Change log row on every detected date change.
//   * Dedup by (tcg, set_code, language). Scryfall codes are
//     unique within MTG; ygoprodeck codes within YGO.
//   * Fail soft: an ingester that can't reach its source leaves
//     existing rows alone and reports the failure via the
//     IngestionResult.

const USER_AGENT = 'CollectorNetwork/0.1 (contact: lukejosephpierce@gmail.com)';

export interface IngestionResult {
  source: string;
  ok: boolean;
  fetched: number;
  upserted: number;
  inserted: number;
  updated: number;
  date_changes: number;
  skipped: number;
  errors: string[];
  duration_ms: number;
}

interface UpsertRow {
  tcg: Tcg;
  site_slug: Tcg;
  set_name: string;
  set_name_original: string | null;
  set_code: string | null;
  product_type: ProductType;
  language: Language;
  region: string | null;
  release_date: string | null;
  release_date_precision: 'day' | 'month' | 'tbc';
  confirmation_status: 'confirmed' | 'announced_tbc';
  source_url: string | null;
}

/** Upsert one row and write a change-log entry if the release_date
 *  moved from a previously-known value. Shared between all
 *  ingesters so the audit trail is consistent. */
async function upsertRelease(
  sb: SupabaseClient,
  row: UpsertRow,
  sourceLabel: string,
): Promise<{ inserted: boolean; dateChanged: boolean; error?: string }> {
  // Lookup existing by (tcg, set_code, language) unique key.
  const { data: existing, error: readErr } = await sb
    .from('network_tcg_releases')
    .select('id, release_date, confirmation_status, source_url, verification_mode')
    .eq('tcg', row.tcg)
    .eq('set_code', row.set_code)
    .eq('language', row.language)
    .maybeSingle();
  if (readErr && readErr.code !== 'PGRST116') return { inserted: false, dateChanged: false, error: readErr.message };

  const now = new Date().toISOString();
  const prev = existing as { id: string; release_date: string | null; confirmation_status: string; source_url: string | null; verification_mode: string } | null;

  if (!prev) {
    const { error: insErr } = await sb.from('network_tcg_releases').insert({
      ...row,
      source_verified_at: now,
      verification_mode: 'automated',
    });
    if (insErr) return { inserted: false, dateChanged: false, error: insErr.message };
    return { inserted: true, dateChanged: false };
  }

  // Preserve operator overrides: if a row was last touched manually,
  // do NOT clobber it with the automated value. verification_mode
  // 'manual' indicates the operator curated it; refresh its
  // source_verified_at but leave date and status alone.
  if (prev.verification_mode === 'manual') {
    await sb.from('network_tcg_releases')
      .update({ source_verified_at: now })
      .eq('id', prev.id);
    return { inserted: false, dateChanged: false };
  }

  const dateChanged = prev.release_date !== row.release_date && row.release_date != null;
  const update: Record<string, unknown> = {
    set_name: row.set_name,
    set_name_original: row.set_name_original,
    product_type: row.product_type,
    region: row.region,
    release_date: row.release_date,
    release_date_precision: row.release_date_precision,
    confirmation_status: row.confirmation_status,
    source_url: row.source_url,
    source_verified_at: now,
    verification_mode: 'automated',
  };
  if (dateChanged) {
    update.previous_release_date = prev.release_date;
    update.date_changed_at = now;
  }
  const { error: updErr } = await sb.from('network_tcg_releases').update(update).eq('id', prev.id);
  if (updErr) return { inserted: false, dateChanged: false, error: updErr.message };

  if (dateChanged) {
    await sb.from('network_tcg_release_changes').insert({
      release_id: prev.id,
      change_type: 'date_changed',
      previous_value: { release_date: prev.release_date, source: sourceLabel },
      new_value: { release_date: row.release_date, source: sourceLabel },
      change_source: 'ingestion',
    });
  }
  return { inserted: false, dateChanged };
}

// ─────────────────── Scryfall / MTG ───────────────────

interface ScryfallSet {
  code: string;
  name: string;
  released_at: string | null;
  set_type: string;
  scryfall_uri: string;
  parent_set_code?: string;
}

export async function ingestScryfallMTG(sb: SupabaseClient): Promise<IngestionResult> {
  const started = Date.now();
  const result: IngestionResult = {
    source: 'scryfall', ok: true, fetched: 0, upserted: 0, inserted: 0, updated: 0,
    date_changes: 0, skipped: 0, errors: [], duration_ms: 0,
  };
  try {
    const res = await fetch('https://api.scryfall.com/sets', {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json() as { object: string; data: ScryfallSet[] };
    const todayIso = new Date().toISOString().slice(0, 10);
    // Keep: future-dated sets whose set_type is a primary release
    // or masterpiece/commander deck. Skip tokens, promos, memorabilia,
    // digital-only — the operator doesn't need these for release prep.
    const KEEP_TYPES = new Set(['expansion', 'core', 'commander', 'masterpiece', 'starter', 'draft_innovation']);
    const SKIP_TYPES = new Set(['token', 'promo', 'memorabilia', 'alchemy', 'planechase', 'archenemy', 'vanguard', 'funny', 'treasure_chest', 'arsenal', 'spellbook']);
    for (const s of payload.data ?? []) {
      result.fetched += 1;
      if (!s.released_at || s.released_at < todayIso) { result.skipped += 1; continue; }
      if (SKIP_TYPES.has(s.set_type)) { result.skipped += 1; continue; }
      if (!KEEP_TYPES.has(s.set_type) && s.set_type !== 'expansion') { result.skipped += 1; continue; }
      const productType: ProductType =
        s.set_type === 'commander' ? 'premium'
        : s.set_type === 'masterpiece' ? 'special_collection'
        : s.set_type === 'starter' ? 'starter_deck'
        : 'expansion';
      const r = await upsertRelease(sb, {
        tcg: 'mtg', site_slug: 'mtg',
        set_name: s.name, set_name_original: null,
        set_code: s.code.toUpperCase(),
        product_type: productType,
        language: 'en', region: null,
        release_date: s.released_at,
        release_date_precision: 'day',
        confirmation_status: 'confirmed',
        source_url: `https://scryfall.com/sets/${s.code}`,
      }, 'scryfall');
      if (r.error) { result.errors.push(`${s.code}: ${r.error}`); continue; }
      result.upserted += 1;
      if (r.inserted) result.inserted += 1; else result.updated += 1;
      if (r.dateChanged) result.date_changes += 1;
    }
  } catch (e) {
    result.ok = false;
    result.errors.push(`scryfall fetch: ${(e as Error).message}`);
  }
  result.duration_ms = Date.now() - started;
  return result;
}

// ─────────────────── ygoprodeck / Yu-Gi-Oh! ───────────────────

interface YgoProDeckSet {
  set_name: string;
  set_code: string;
  tcg_date: string | null;         // ISO date YYYY-MM-DD
  num_of_cards?: number;
}

export async function ingestYgoProDeckYGO(sb: SupabaseClient): Promise<IngestionResult> {
  const started = Date.now();
  const result: IngestionResult = {
    source: 'ygoprodeck', ok: true, fetched: 0, upserted: 0, inserted: 0, updated: 0,
    date_changes: 0, skipped: 0, errors: [], duration_ms: 0,
  };
  try {
    const res = await fetch('https://db.ygoprodeck.com/api/v7/cardsets.php', {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const sets = await res.json() as YgoProDeckSet[];
    const todayIso = new Date().toISOString().slice(0, 10);
    // Only future-dated sets. ygoprodeck ships booster packs, special
    // sets, structure decks, etc. without clean product_type metadata —
    // best we can do is heuristic on the name.
    for (const s of sets) {
      result.fetched += 1;
      if (!s.tcg_date || s.tcg_date < todayIso) { result.skipped += 1; continue; }
      if (!s.set_code) { result.skipped += 1; continue; }
      const name = s.set_name.toLowerCase();
      const productType: ProductType =
        /\bstructure deck|\bsd\d/.test(name) ? 'structure_deck'
        : /\bstarter|\bst\d/.test(name) ? 'starter_deck'
        : /\btin|\bcollector|\bduelist/.test(name) ? 'special_collection'
        : /\bpromo/.test(name) ? 'promo'
        : /pack|booster/.test(name) ? 'booster'
        : 'expansion';
      const r = await upsertRelease(sb, {
        tcg: 'ygo', site_slug: 'ygo',
        set_name: s.set_name, set_name_original: null,
        set_code: s.set_code,
        product_type: productType,
        language: 'en', region: null,
        release_date: s.tcg_date,
        release_date_precision: 'day',
        confirmation_status: 'confirmed',
        source_url: `https://db.ygoprodeck.com/set/?search=${encodeURIComponent(s.set_name)}`,
      }, 'ygoprodeck');
      if (r.error) { result.errors.push(`${s.set_code}: ${r.error}`); continue; }
      result.upserted += 1;
      if (r.inserted) result.inserted += 1; else result.updated += 1;
      if (r.dateChanged) result.date_changes += 1;
    }
  } catch (e) {
    result.ok = false;
    result.errors.push(`ygoprodeck fetch: ${(e as Error).message}`);
  }
  result.duration_ms = Date.now() - started;
  return result;
}
