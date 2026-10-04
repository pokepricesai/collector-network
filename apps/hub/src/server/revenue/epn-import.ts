import 'server-only';

// eBay Partner Network CSV import.
//
// EPN's transaction report CSV format varies slightly over the years;
// we support the common header shape used by their "Transactions"
// download. Unknown columns are ignored. Required columns:
//
//   Event Date (or Transaction Date / Timestamp)
//   Earnings (or Total Earnings)
//   Item Title (optional, used for description)
//   Campaign (or Campaign ID — maps to our site)
//   Custom ID (or Sub ID — kept as source_detail for placement)
//   Event / Status / Transaction Status (confirmed / pending / reversed)
//   Order ID or Transaction ID (used for stable idempotency)
//   Currency (if absent, default GBP for UK campaigns, USD for US)
//
// The importer is strict about numbers (never guesses) and strict
// about dates (ISO 8601 or dd/mm/yyyy). An unparseable row is
// rejected with a reason; the UI shows all rejects so the admin can
// clean up the file.

export interface EpnCampaignMap {
  // Campaign IDs → network_sites UUIDs. The map is provided by the
  // caller from Supabase so the import route stays stateless.
  byCampaignId: Record<string, { siteId: string; siteSlug: string; sourceId: string; currency: string }>;
}

export type EpnStatus = 'confirmed' | 'pending' | 'reversed' | 'unknown';

export interface EpnRow {
  row_index: number;         // 1-based within the file
  transaction_id: string;
  occurred_on: string;       // yyyy-mm-dd (UTC)
  earnings_minor: number;    // can be negative for reversals
  currency: string;
  campaign_id: string | null;
  custom_id: string | null;
  status: EpnStatus;
  item_title: string | null;
  mapped_site_id: string | null;
  mapped_site_slug: string | null;
  mapped_source_id: string | null;
  idempotency_key: string;
  issues: string[];
}

export interface EpnPreview {
  file_name: string;
  total_rows: number;
  accepted: EpnRow[];
  rejected: Array<{ row_index: number; reason: string; raw: Record<string, string> }>;
  totals_by_currency: Record<string, { net_minor: number; row_count: number; pending_minor: number; reversed_minor: number }>;
  date_min: string | null;
  date_max: string | null;
  unmapped_campaigns: string[];
  duplicate_transaction_ids: string[];
}

const EARNINGS_KEYS = ['Earnings', 'Total Earnings', 'Commission', 'Partner Earnings', 'Earnings USD', 'Earnings GBP'];
const DATE_KEYS = ['Event Date', 'Transaction Date', 'Date', 'Timestamp', 'Event Time'];
const CAMPAIGN_KEYS = ['Campaign ID', 'Campaign Id', 'Campaign', 'CampaignId'];
const CUSTOMID_KEYS = ['Custom ID', 'Custom Id', 'Sub ID', 'SubID', 'Sub Id'];
const STATUS_KEYS = ['Status', 'Transaction Status', 'Event', 'Transaction Type'];
const TXID_KEYS = ['Order ID', 'Transaction ID', 'Transaction Id', 'OrderID', 'Event ID', 'EventID'];
const CURRENCY_KEYS = ['Currency', 'Currency Code'];
const TITLE_KEYS = ['Item Title', 'Title', 'Product Title'];

function pick(row: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
  }
  return null;
}

function parseDate(raw: string): string | null {
  // ISO 8601 or ISO date-only.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // dd/mm/yyyy or dd-mm-yyyy.
  const uk = raw.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (uk) return `${uk[3]}-${uk[2]}-${uk[1]}`;
  // yyyy/mm/dd.
  const alt = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (alt) return `${alt[1]}-${alt[2]}-${alt[3]}`;
  return null;
}

function parseMoney(raw: string): number | null {
  // Allow leading currency symbols + thousands separators + minus sign.
  const cleaned = raw.replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  const minor = Math.round(n * 100);
  if (!Number.isSafeInteger(minor)) return null;
  return minor;
}

function normaliseStatus(raw: string | null): EpnStatus {
  if (!raw) return 'unknown';
  const s = raw.toLowerCase();
  if (/(confirm|paid|approved|closed)/.test(s)) return 'confirmed';
  if (/(pending|open|review)/.test(s)) return 'pending';
  if (/(revers|refund|cancel|charg)/.test(s)) return 'reversed';
  if (/(sale|click|action|commission)/.test(s)) return 'confirmed';
  return 'unknown';
}

/**
 * Minimal RFC-4180-ish CSV parser. Handles quoted fields with embedded
 * commas and doubled double-quotes. Deliberately not a dependency.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const headerRow = rows[0] ?? [];
  const header = headerRow.map((h) => h.trim());
  return rows.slice(1).filter((r) => r.length > 0 && r.some((v) => v && v.trim() !== '')).map((r) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      const key = header[i];
      if (key == null) continue;
      obj[key] = r[i] ?? '';
    }
    return obj;
  });
}

export function buildEpnPreview(
  fileName: string,
  csvText: string,
  campaignMap: EpnCampaignMap,
): EpnPreview {
  const raw = parseCsv(csvText);
  const accepted: EpnRow[] = [];
  const rejected: EpnPreview['rejected'] = [];
  const totalsByCurrency: Record<string, { net_minor: number; row_count: number; pending_minor: number; reversed_minor: number }> = {};
  const dedupe = new Set<string>();
  const duplicatesSeen = new Set<string>();
  const unmapped = new Set<string>();
  let dateMin: string | null = null;
  let dateMax: string | null = null;

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!r) continue;
    const idx = i + 1;
    const dateRaw = pick(r, DATE_KEYS);
    const date = dateRaw ? parseDate(dateRaw) : null;
    if (!date) { rejected.push({ row_index: idx, reason: `unparseable date: "${dateRaw ?? ''}"`, raw: r }); continue; }

    const earningsRaw = pick(r, EARNINGS_KEYS);
    const earnings = earningsRaw ? parseMoney(earningsRaw) : null;
    if (earnings == null) { rejected.push({ row_index: idx, reason: `unparseable earnings: "${earningsRaw ?? ''}"`, raw: r }); continue; }

    const campaign = pick(r, CAMPAIGN_KEYS);
    const customId = pick(r, CUSTOMID_KEYS);
    const statusRaw = pick(r, STATUS_KEYS);
    const status = normaliseStatus(statusRaw);
    const txId = pick(r, TXID_KEYS) ?? `${date}:${earnings}:${customId ?? ''}:${idx}`;
    const title = pick(r, TITLE_KEYS);

    let currency = pick(r, CURRENCY_KEYS) ?? '';
    if (!currency) currency = (campaign && campaignMap.byCampaignId[campaign]?.currency) ?? 'GBP';
    currency = currency.toUpperCase();
    if (currency.length !== 3) { rejected.push({ row_index: idx, reason: `invalid currency "${currency}"`, raw: r }); continue; }

    const mapped = campaign ? campaignMap.byCampaignId[campaign] : undefined;
    if (campaign && !mapped) unmapped.add(campaign);

    const signedEarnings = status === 'reversed' ? -Math.abs(earnings) : earnings;

    const idemp = `epn:${txId}`;
    if (dedupe.has(idemp)) { duplicatesSeen.add(txId); }
    dedupe.add(idemp);

    const row: EpnRow = {
      row_index: idx,
      transaction_id: txId,
      occurred_on: date,
      earnings_minor: signedEarnings,
      currency,
      campaign_id: campaign,
      custom_id: customId,
      status,
      item_title: title,
      mapped_site_id: mapped?.siteId ?? null,
      mapped_site_slug: mapped?.siteSlug ?? null,
      mapped_source_id: mapped?.sourceId ?? null,
      idempotency_key: idemp,
      issues: campaign && !mapped ? [`unmapped campaign: ${campaign}`] : [],
    };
    accepted.push(row);

    const bucket = totalsByCurrency[currency] ?? { net_minor: 0, row_count: 0, pending_minor: 0, reversed_minor: 0 };
    bucket.row_count += 1;
    bucket.net_minor += signedEarnings;
    if (status === 'pending') bucket.pending_minor += signedEarnings;
    if (status === 'reversed') bucket.reversed_minor += signedEarnings;
    totalsByCurrency[currency] = bucket;

    if (!dateMin || date < dateMin) dateMin = date;
    if (!dateMax || date > dateMax) dateMax = date;
  }

  return {
    file_name: fileName,
    total_rows: raw.length,
    accepted,
    rejected,
    totals_by_currency: totalsByCurrency,
    date_min: dateMin,
    date_max: dateMax,
    unmapped_campaigns: Array.from(unmapped),
    duplicate_transaction_ids: Array.from(duplicatesSeen),
  };
}
