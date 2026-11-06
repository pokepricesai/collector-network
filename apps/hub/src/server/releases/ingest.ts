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
  // Actual date overwrites on pending-review / not-yet-public rows.
  date_changes: number;
  // Date SHIFTS that were converted to operator-reviewable PROPOSALS
  // because the row was already approved. The public feed keeps
  // serving the approved date until the operator acts.
  date_proposals: number;
  // Rows left untouched because they were manual or rejected.
  skipped_preserved: number;
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

/** Upsert one row through the review gate. The ingester NEVER
 *  publishes a row directly:
 *
 *    - New rows land with review_status='pending_review' (invisible
 *      on the public feed until an operator approves).
 *    - Manual rows (verification_mode='manual') are preserved as
 *      before — only source_verified_at is refreshed.
 *    - Rejected rows are left alone (operator said no).
 *    - On a pending_review row with a shifted date, release_date
 *      is updated directly — still invisible publicly, so no need
 *      to double-gate.
 *    - On an APPROVED row with a shifted date, the new date is
 *      written to proposed_release_date, NOT release_date. The
 *      operator must explicitly accept or reject the proposal.
 *
 *  Every state transition writes a change-log row with
 *  change_source='ingestion' and the appropriate change_type.
 *
 *  Note: this function reads columns added by the 20261107010000
 *  review-gate migration. The Hub deployment that carries this
 *  ingester must land AFTER that migration is applied. */
async function upsertRelease(
  sb: SupabaseClient,
  row: UpsertRow,
  sourceLabel: string,
): Promise<{ inserted: boolean; dateChanged: boolean; dateProposed: boolean; skipped: boolean; error?: string }> {
  // Lookup existing by (tcg, set_code, language) unique key.
  const { data: existing, error: readErr } = await sb
    .from('network_tcg_releases')
    .select('id, release_date, release_date_precision, confirmation_status, source_url, verification_mode, review_status, proposed_release_date')
    .eq('tcg', row.tcg)
    .eq('set_code', row.set_code)
    .eq('language', row.language)
    .maybeSingle();
  if (readErr && readErr.code !== 'PGRST116') {
    return { inserted: false, dateChanged: false, dateProposed: false, skipped: false, error: readErr.message };
  }

  const now = new Date().toISOString();
  const prev = existing as {
    id: string;
    release_date: string | null;
    release_date_precision: 'day' | 'month' | 'tbc';
    confirmation_status: string;
    source_url: string | null;
    verification_mode: 'manual' | 'automated';
    review_status: 'pending_review' | 'approved' | 'rejected';
    proposed_release_date: string | null;
  } | null;

  // ── NEW ROW ────────────────────────────────────────────────
  // Insert with explicit review_status='pending_review' so the
  // intent is visible in the row even if the column default is
  // ever changed. The public view filters pending rows out.
  if (!prev) {
    const { error: insErr } = await sb.from('network_tcg_releases').insert({
      ...row,
      source_verified_at: now,
      verification_mode: 'automated',
      review_status: 'pending_review',
    });
    if (insErr) return { inserted: false, dateChanged: false, dateProposed: false, skipped: false, error: insErr.message };
    return { inserted: true, dateChanged: false, dateProposed: false, skipped: false };
  }

  // ── MANUAL ROW (operator-curated) ──────────────────────────
  // Never clobber. Only refresh source_verified_at so admin UI
  // shows the row is still backed by the third-party catalogue.
  if (prev.verification_mode === 'manual') {
    await sb.from('network_tcg_releases')
      .update({ source_verified_at: now })
      .eq('id', prev.id);
    return { inserted: false, dateChanged: false, dateProposed: false, skipped: true };
  }

  // ── REJECTED ROW ───────────────────────────────────────────
  // Operator said no. Do not resurrect by re-publishing or
  // flipping back to pending_review. Just refresh timestamp.
  if (prev.review_status === 'rejected') {
    await sb.from('network_tcg_releases')
      .update({ source_verified_at: now })
      .eq('id', prev.id);
    return { inserted: false, dateChanged: false, dateProposed: false, skipped: true };
  }

  const dateChanged = prev.release_date !== row.release_date && row.release_date != null;

  // ── APPROVED ROW ───────────────────────────────────────────
  // Date shift becomes a PROPOSAL. Public feed continues to
  // serve the approved release_date. Non-date fields (name, set
  // code, region, etc.) can refresh — those don't change the
  // calendar entry's public date surface.
  if (prev.review_status === 'approved') {
    const update: Record<string, unknown> = {
      set_name: row.set_name,
      set_name_original: row.set_name_original,
      product_type: row.product_type,
      region: row.region,
      source_url: row.source_url,
      source_verified_at: now,
    };
    if (dateChanged) {
      update.proposed_release_date = row.release_date;
      update.proposed_release_date_precision = row.release_date_precision;
      update.proposed_change_at = now;
      update.proposed_change_source = `ingestion:${sourceLabel}`;
    }
    const { error: updErr } = await sb.from('network_tcg_releases').update(update).eq('id', prev.id);
    if (updErr) return { inserted: false, dateChanged: false, dateProposed: false, skipped: false, error: updErr.message };
    if (dateChanged) {
      await sb.from('network_tcg_release_changes').insert({
        release_id: prev.id,
        change_type: 'date_proposed',
        previous_value: { release_date: prev.release_date, source: sourceLabel },
        new_value: { proposed_release_date: row.release_date, source: sourceLabel },
        change_source: 'ingestion',
      });
      return { inserted: false, dateChanged: false, dateProposed: true, skipped: false };
    }
    return { inserted: false, dateChanged: false, dateProposed: false, skipped: false };
  }

  // ── PENDING_REVIEW ROW ─────────────────────────────────────
  // Not yet public. Can update release_date freely; the review
  // gate still holds until operator approves.
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
  };
  if (dateChanged) {
    update.previous_release_date = prev.release_date;
    update.date_changed_at = now;
  }
  const { error: updErr } = await sb.from('network_tcg_releases').update(update).eq('id', prev.id);
  if (updErr) return { inserted: false, dateChanged: false, dateProposed: false, skipped: false, error: updErr.message };
  if (dateChanged) {
    await sb.from('network_tcg_release_changes').insert({
      release_id: prev.id,
      change_type: 'date_changed',
      previous_value: { release_date: prev.release_date, source: sourceLabel },
      new_value: { release_date: row.release_date, source: sourceLabel },
      change_source: 'ingestion',
    });
  }
  return { inserted: false, dateChanged, dateProposed: false, skipped: false };
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
    date_changes: 0, date_proposals: 0, skipped_preserved: 0, skipped: 0, errors: [], duration_ms: 0,
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
      if (r.skipped) { result.skipped_preserved += 1; continue; }
      result.upserted += 1;
      if (r.inserted) result.inserted += 1; else result.updated += 1;
      if (r.dateChanged) result.date_changes += 1;
      if (r.dateProposed) result.date_proposals += 1;
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
    date_changes: 0, date_proposals: 0, skipped_preserved: 0, skipped: 0, errors: [], duration_ms: 0,
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
      if (r.skipped) { result.skipped_preserved += 1; continue; }
      result.upserted += 1;
      if (r.inserted) result.inserted += 1; else result.updated += 1;
      if (r.dateChanged) result.date_changes += 1;
      if (r.dateProposed) result.date_proposals += 1;
    }
  } catch (e) {
    result.ok = false;
    result.errors.push(`ygoprodeck fetch: ${(e as Error).message}`);
  }
  result.duration_ms = Date.now() - started;
  return result;
}
