import 'server-only';

// CN-06.05-P03: PSA public API client (GetPSASpecPopulation only).
//
// Endpoint:  GET https://api.psacard.com/publicapi/pop/GetPSASpecPopulation/{specID}
// Auth:      Authorization: bearer <PSA_PUBLIC_API_TOKEN>  (per PSA docs; token obtained from
//            the PSA account dashboard; the operator sets this in Vercel env).
// Documentation link kept in a comment, NOT fetched at runtime.
//
// This client NEVER:
//   - Logs the token.
//   - Writes the token to the database.
//   - Retries on 401/403/429 (abort + surface to caller for day-level halt).
//
// Validation: the endpoint returns a payload including `SpecID` (or the
// variant key the docs use); we reject responses whose returned SpecID
// does not match the request. Mis-matching responses are treated as
// hard failures — never upserted — to honour the mapping invariants
// in the P03 brief.

export type PsaApiError = {
  kind: 'network' | 'http' | 'parse' | 'spec_mismatch' | 'rate_limited' | 'unauthorized' | 'forbidden'
  status?: number
  message: string
  retryAfterSeconds?: number
}

/** Result of a GetPSASpecPopulation call. */
export type PsaSpecPopulationResult =
  | { ok: true; specId: string; payload: PsaSpecPopulationPayload; rawJson: unknown }
  | { ok: false; error: PsaApiError }

/** The normalised shape we persist. Fields map to the documented
 *  PSAPop structure. Any field not present in the response stays null. */
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

/** Normalise a wide variety of key casings into a PsaSpecPopulationPayload.
 *  PSA's historical/public responses use PascalCase; we also accept
 *  snake_case to tolerate future shape changes. Unknown keys are ignored.
 *  Qualified pop keys (if the API exposes them) aggregate into qualified_total. */
export function parsePsaSpecPopulation(payload: unknown): PsaSpecPopulationPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload as Record<string, unknown>

  // Accept either a direct object or a { PSAPop: { ... } } envelope.
  const pop = (raw.PSAPop && typeof raw.PSAPop === 'object' ? raw.PSAPop
            : (raw.psaPop && typeof raw.psaPop === 'object' ? raw.psaPop
            : raw)) as Record<string, unknown>

  const pick = (...keys: string[]): number | null => {
    for (const k of keys) {
      if (k in pop && pop[k] != null) return toNum(pop[k])
    }
    return null
  }

  const out: PsaSpecPopulationPayload = {
    auth:    pick('Auth', 'auth'),
    psa_1:   pick('PSA1', 'psa_1'),
    psa_1_5: pick('PSA1_5', 'psa_1_5', 'PSAHalf1'),
    psa_2:   pick('PSA2', 'psa_2'),
    psa_2_5: pick('PSA2_5', 'psa_2_5', 'PSAHalf2'),
    psa_3:   pick('PSA3', 'psa_3'),
    psa_3_5: pick('PSA3_5', 'psa_3_5', 'PSAHalf3'),
    psa_4:   pick('PSA4', 'psa_4'),
    psa_4_5: pick('PSA4_5', 'psa_4_5', 'PSAHalf4'),
    psa_5:   pick('PSA5', 'psa_5'),
    psa_5_5: pick('PSA5_5', 'psa_5_5', 'PSAHalf5'),
    psa_6:   pick('PSA6', 'psa_6'),
    psa_6_5: pick('PSA6_5', 'psa_6_5', 'PSAHalf6'),
    psa_7:   pick('PSA7', 'psa_7'),
    psa_7_5: pick('PSA7_5', 'psa_7_5', 'PSAHalf7'),
    psa_8:   pick('PSA8', 'psa_8'),
    psa_8_5: pick('PSA8_5', 'psa_8_5', 'PSAHalf8'),
    psa_9:   pick('PSA9', 'psa_9'),
    psa_9_5: pick('PSA9_5', 'psa_9_5', 'PSAHalf9'),
    psa_10:  pick('PSA10', 'psa_10'),
    qualified_total: pick('QualifiedTotal', 'qualified_total'),
    total_graded:    pick('TotalPop', 'TotalGraded', 'total_graded'),
    gem_rate:        pick('GemRate', 'gem_rate'),
  }

  // Compute total_graded as a fallback sum if PSA did not provide it.
  if (out.total_graded == null) {
    let sum = 0
    for (const v of [
      out.auth,
      out.psa_1, out.psa_1_5, out.psa_2, out.psa_2_5, out.psa_3, out.psa_3_5,
      out.psa_4, out.psa_4_5, out.psa_5, out.psa_5_5, out.psa_6, out.psa_6_5,
      out.psa_7, out.psa_7_5, out.psa_8, out.psa_8_5, out.psa_9, out.psa_9_5,
      out.psa_10, out.qualified_total,
    ]) if (v != null) sum += v
    out.total_graded = sum > 0 ? sum : null
  }

  // Compute gem_rate if missing.
  if (out.gem_rate == null && out.total_graded && out.total_graded > 0 && out.psa_10 != null) {
    out.gem_rate = Math.round((out.psa_10 / out.total_graded) * 10_000) / 100
  }

  return out
}

/** Validate the returned payload's SpecID matches the requested one.
 *  Accepts common key variants. Returns the matched spec_id string
 *  on success, or null if the response doesn't identify its spec. */
export function extractReturnedSpecId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload as Record<string, unknown>
  const envelope = (raw.PSAPop && typeof raw.PSAPop === 'object' ? raw.PSAPop as Record<string, unknown>
                : (raw.psaPop && typeof raw.psaPop === 'object' ? raw.psaPop as Record<string, unknown>
                : raw))
  for (const k of ['SpecID', 'specId', 'SpecId', 'spec_id', 'PSASpecId']) {
    const v = envelope[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return null
}

/** Fetch GetPSASpecPopulation for one spec_id. Pure wrapper around fetch();
 *  no retry, no backoff — the scheduler is in charge of day-level pacing
 *  and halting. Token is read fresh from env so a rotation takes effect
 *  on the next call without redeploy. */
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
  if (!res.ok)            return { ok: false, error: { kind: 'http',          status: res.status, message: `PSA HTTP ${res.status}`, retryAfterSeconds } }

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

  return { ok: true, specId, payload, rawJson: json }
}
