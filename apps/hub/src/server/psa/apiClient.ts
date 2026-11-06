import 'server-only';

// CN-06.05-P03/P04: PSA public API client — GetPSASpecPopulation only.
//
// Endpoint:  GET https://api.psacard.com/publicapi/pop/GetPSASpecPopulation/{specID}
// Auth:      Authorization: bearer <PSA_PUBLIC_API_TOKEN>
// Swagger:   https://api.psacard.com/publicapi/swagger.json
//
// Response schema (verified against the swagger, 2026-11-06):
//   PSASpecPopulationModel {
//     SpecID:      int32
//     Description: string
//     PSAPop:      PSASpecPopSummaryModel  — total/grade counts for the main spec
//     PSADNAPop:   PSASpecPopSummaryModel  — same shape, PSA/DNA (autograph) sub-pop
//   }
//
//   PSASpecPopSummaryModel {
//     Total:    int32     — grand total graded under this sub-pop
//     Auth:     int32     — authentic-only (not numerically graded)
//     Grade1 … Grade10:                   numeric grade counts
//     Grade1_5 … Grade9_5:                half-grade counts
//     Grade1Q … Grade9Q, Grade1_5Q … Grade9_5Q:   qualified-grade counts
//     (Grade10 has NO Grade10Q — a PSA 10 cannot be qualified.)
//   }
//
// We store:
//   psa_1 … psa_10            (from Grade1 … Grade10)
//   psa_1_5 … psa_9_5         (from Grade1_5 … Grade9_5)
//   auth                      (from Auth)
//   total_graded              (from Total; NEVER synthesised when PSA omits it)
//   qualified_total           (SUM of all Grade*Q present; NEVER synthesised)
//   gem_rate                  (derived only when Total > 0 AND Grade10 is present)
//
// PSADNAPop is intentionally not written to our pop tables today — the
// cn_psa_pop_latest columns describe the main pop only. The full response
// is preserved in cn_psa_pop_latest.raw_response_jsonb for future use.
//
// Safety invariants (enforced here; see unit tests):
//   • Malformed response (no PSAPop envelope, no recognised keys)
//     → ok:false with kind='parse'. Nothing is written.
//   • Missing Total is NOT fabricated by summing grade counts. total_graded
//     stays null; the scheduler still records the attempt but no synthetic
//     zero population surfaces downstream.
//   • Missing/non-numeric grade values become null, not 0.
//   • Returned SpecID must equal the requested one; mismatches reject.

export type PsaApiError = {
  kind: 'network' | 'http' | 'parse' | 'spec_mismatch' | 'rate_limited' | 'unauthorized' | 'forbidden'
  status?: number
  message: string
  retryAfterSeconds?: number
}

export type PsaSpecPopulationResult =
  | { ok: true; specId: string; description: string | null; payload: PsaSpecPopulationPayload; rawJson: unknown }
  | { ok: false; error: PsaApiError }

/** Normalised payload persisted into cn_psa_pop_latest / legacy psa_population.
 *  Every field is null-or-number. Nulls mean PSA did not supply a value. */
export type PsaSpecPopulationPayload = {
  auth:       number | null
  psa_1:      number | null
  psa_1_5:    number | null
  psa_2:      number | null
  psa_2_5:    number | null
  psa_3:      number | null
  psa_3_5:    number | null
  psa_4:      number | null
  psa_4_5:    number | null
  psa_5:      number | null
  psa_5_5:    number | null
  psa_6:      number | null
  psa_6_5:    number | null
  psa_7:      number | null
  psa_7_5:    number | null
  psa_8:      number | null
  psa_8_5:    number | null
  psa_9:      number | null
  psa_9_5:    number | null
  psa_10:     number | null
  qualified_total: number | null
  total_graded:    number | null
  gem_rate:        number | null
}

function toNum(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Parse the PSA SpecPopulation response body into our normalised shape.
 *
 *  Returns null on structural failure (envelope missing, no grade keys at
 *  all) — the caller treats this as a parse error and never writes. */
export function parsePsaSpecPopulation(payload: unknown): PsaSpecPopulationPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const envelope = payload as Record<string, unknown>

  // Accept either a direct PSAPop object OR the full PSASpecPopulationModel
  // wrapper (which is what the API returns).
  const pop = (envelope.PSAPop && typeof envelope.PSAPop === 'object'
    ? envelope.PSAPop
    : envelope) as Record<string, unknown>

  // Structural guard: a valid PSAPop sub-object must carry at least one of
  // the documented Swagger keys. If none appear, this is not a valid
  // envelope — refuse rather than fabricate a zero population.
  const DOCUMENTED_KEYS: readonly string[] = [
    'Total','Auth',
    'Grade1','Grade1_5','Grade2','Grade2_5','Grade3','Grade3_5',
    'Grade4','Grade4_5','Grade5','Grade5_5','Grade6','Grade6_5',
    'Grade7','Grade7_5','Grade8','Grade8_5','Grade9','Grade9_5','Grade10',
    'Grade1Q','Grade1_5Q','Grade2Q','Grade2_5Q','Grade3Q','Grade3_5Q',
    'Grade4Q','Grade4_5Q','Grade5Q','Grade5_5Q','Grade6Q','Grade6_5Q',
    'Grade7Q','Grade7_5Q','Grade8Q','Grade8_5Q','Grade9Q','Grade9_5Q',
  ]
  const hasAnyDocumented = DOCUMENTED_KEYS.some(k => k in pop)
  if (!hasAnyDocumented) return null

  const g = (k: string): number | null => (k in pop ? toNum(pop[k]) : null)

  const out: PsaSpecPopulationPayload = {
    auth:    g('Auth'),
    psa_1:   g('Grade1'),   psa_1_5: g('Grade1_5'),
    psa_2:   g('Grade2'),   psa_2_5: g('Grade2_5'),
    psa_3:   g('Grade3'),   psa_3_5: g('Grade3_5'),
    psa_4:   g('Grade4'),   psa_4_5: g('Grade4_5'),
    psa_5:   g('Grade5'),   psa_5_5: g('Grade5_5'),
    psa_6:   g('Grade6'),   psa_6_5: g('Grade6_5'),
    psa_7:   g('Grade7'),   psa_7_5: g('Grade7_5'),
    psa_8:   g('Grade8'),   psa_8_5: g('Grade8_5'),
    psa_9:   g('Grade9'),   psa_9_5: g('Grade9_5'),
    psa_10:  g('Grade10'),
    qualified_total: null,  // sum below ONLY if at least one Q key is present
    total_graded:    g('Total'),
    gem_rate:        null,  // derived below ONLY if Total > 0 and psa_10 present
  }

  // Qualified-total: sum every Grade*Q field that PSA actually returned.
  // If none are present, qualified_total stays null (NOT 0).
  const Q_KEYS: readonly string[] = [
    'Grade1Q','Grade1_5Q','Grade2Q','Grade2_5Q','Grade3Q','Grade3_5Q',
    'Grade4Q','Grade4_5Q','Grade5Q','Grade5_5Q','Grade6Q','Grade6_5Q',
    'Grade7Q','Grade7_5Q','Grade8Q','Grade8_5Q','Grade9Q','Grade9_5Q',
  ]
  let qSum: number | null = null
  for (const k of Q_KEYS) {
    if (k in pop) {
      const n = toNum(pop[k])
      if (n != null) qSum = (qSum ?? 0) + n
    }
  }
  out.qualified_total = qSum

  // Gem rate: derived ONLY when PSA supplied both a positive Total and a
  // numeric Grade10. Never synthesise from a missing Total.
  if (out.total_graded != null && out.total_graded > 0 && out.psa_10 != null) {
    out.gem_rate = Math.round((out.psa_10 / out.total_graded) * 10_000) / 100
  }

  return out
}

/** Validate the returned SpecID matches the requested one. SpecID sits on
 *  the outer PSASpecPopulationModel, not under PSAPop. */
export function extractReturnedSpecId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload as Record<string, unknown>
  const v = raw.SpecID ?? raw.specId ?? raw.spec_id
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

/** Extract Description from the PSASpecPopulationModel envelope. Useful
 *  for operator identity cross-check when reviewing pilot results. */
export function extractDescription(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload as Record<string, unknown>
  const d = raw.Description
  return typeof d === 'string' ? d : null
}

/** Fetch GetPSASpecPopulation for one spec_id. No retries. Token read fresh
 *  from env so rotation takes effect without redeploy. */
export async function fetchPsaSpecPopulation(
  specId: string,
  opts: { fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number } = {},
): Promise<PsaSpecPopulationResult> {
  const token = (process.env['PSA_PUBLIC_API_TOKEN'] ?? '').trim()
  if (!token) return { ok: false, error: { kind: 'unauthorized', message: 'PSA_PUBLIC_API_TOKEN not set' } }
  if (!/^\d+$/.test(specId)) {
    return { ok: false, error: { kind: 'parse', message: 'invalid spec_id (not numeric)' } }
  }
  const base = (opts.baseUrl ?? 'https://api.psacard.com').replace(/\/+$/, '')
  const url = `${base}/publicapi/pop/GetPSASpecPopulation/${encodeURIComponent(specId)}`
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? 15_000
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'Authorization': `bearer ${token}`,
        'Accept': 'application/json',
      },
      signal: ctl.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    const msg = e instanceof Error ? e.message : 'network error'
    return { ok: false, error: { kind: 'network', message: msg.slice(0, 200) } }
  }
  clearTimeout(timer)

  const retryAfterHeader = res.headers.get('retry-after')
  const retryAfterSeconds = retryAfterHeader ? Math.max(0, Number(retryAfterHeader)) : undefined

  if (res.status === 401) return { ok: false, error: { kind: 'unauthorized', status: 401, message: 'PSA 401 unauthorized', retryAfterSeconds } }
  if (res.status === 403) return { ok: false, error: { kind: 'forbidden',    status: 403, message: 'PSA 403 forbidden',    retryAfterSeconds } }
  if (res.status === 429) return { ok: false, error: { kind: 'rate_limited', status: 429, message: 'PSA 429 rate limited', retryAfterSeconds } }
  if (!res.ok)            return { ok: false, error: { kind: 'http',         status: res.status, message: `PSA HTTP ${res.status}`, retryAfterSeconds } }

  let json: unknown
  try {
    json = await res.json()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'parse error'
    return { ok: false, error: { kind: 'parse', message: msg.slice(0, 200) } }
  }

  const returned = extractReturnedSpecId(json)
  if (returned != null && returned !== specId) {
    return { ok: false, error: { kind: 'spec_mismatch', message: `requested ${specId}, got ${returned}` } }
  }
  const payload = parsePsaSpecPopulation(json)
  if (!payload) return { ok: false, error: { kind: 'parse', message: 'response did not parse into PsaSpecPopulationPayload' } }

  return { ok: true, specId, description: extractDescription(json), payload, rawJson: json }
}
