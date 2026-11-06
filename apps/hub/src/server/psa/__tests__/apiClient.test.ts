import { describe, it, expect, afterEach } from 'vitest'
import {
  parsePsaSpecPopulation,
  extractReturnedSpecId,
  extractDescription,
  fetchPsaSpecPopulation,
} from '../apiClient'

// Fixture: the full PSASpecPopulationModel shape per the official Swagger
// at https://api.psacard.com/publicapi/swagger.json (verified 2026-11-06).
//
// - Grade keys are Grade1..Grade10, Grade*_5, Grade*Q
// - Total + Auth at the summary level
// - SpecID + Description at the outer model
// - PSADNAPop is a separate sub-pop (we currently persist main-pop only;
//   tests here cover the main-pop parsing)
const FIXTURE_FULL_SWAGGER = {
  SpecID: 544023,
  Description: 'POKEMON BASE SET-UNLIMITED #2 BLASTOISE-HOLO',
  PSAPop: {
    Total: 48226,
    Auth: 120,
    Grade1:   200, Grade1_5: 10,
    Grade2:   300, Grade2_5: 40,
    Grade3:   500, Grade3_5: 90,
    Grade4:   900, Grade4_5: 150,
    Grade5:  1800, Grade5_5: 400,
    Grade6:  3200, Grade6_5: 900,
    Grade7:  7000, Grade7_5: 2200,
    Grade8: 14000, Grade8_5: 3500,
    Grade9: 11000, Grade9_5: 1444,
    Grade10:  382,
    Grade1Q: 5, Grade2Q: 7, Grade3Q: 11, Grade4Q: 14, Grade5Q: 20,
    Grade6Q: 25, Grade7Q: 30, Grade8Q: 35, Grade9Q: 40,
    Grade1_5Q: 1, Grade2_5Q: 2, Grade3_5Q: 3,
  },
  PSADNAPop: {
    Total: 300, Auth: 20, Grade10: 50,
  },
}

describe('parsePsaSpecPopulation — Swagger-correct PSAPop shape', () => {
  it('maps Grade1..Grade10 and Grade*_5 into the psa_1..psa_10 and psa_*_5 fields', () => {
    const parsed = parsePsaSpecPopulation(FIXTURE_FULL_SWAGGER)
    expect(parsed).not.toBeNull()
    expect(parsed!.psa_10).toBe(382)
    expect(parsed!.psa_9).toBe(11000)
    expect(parsed!.psa_1_5).toBe(10)
    expect(parsed!.psa_8_5).toBe(3500)
    expect(parsed!.psa_2).toBe(300)
    expect(parsed!.auth).toBe(120)
    expect(parsed!.total_graded).toBe(48226)   // from Total, NOT TotalPop
  })

  it('qualified_total = sum of every Grade*Q present (never synthesised when none appear)', () => {
    const parsed = parsePsaSpecPopulation(FIXTURE_FULL_SWAGGER)!
    // Sum of all Q values in the fixture:
    //   5+7+11+14+20+25+30+35+40 + 1+2+3 = 193
    expect(parsed.qualified_total).toBe(193)
  })

  it('gem_rate derived only when Total > 0 AND Grade10 present', () => {
    const parsed = parsePsaSpecPopulation(FIXTURE_FULL_SWAGGER)!
    // 382 / 48226 * 100 = 0.7920... → rounded to 0.79
    expect(parsed.gem_rate).toBeCloseTo(0.79, 2)
  })

  it('accepts a bare PSAPop object (no outer envelope)', () => {
    const parsed = parsePsaSpecPopulation(FIXTURE_FULL_SWAGGER.PSAPop)
    expect(parsed).not.toBeNull()
    expect(parsed!.psa_10).toBe(382)
    expect(parsed!.total_graded).toBe(48226)
  })

  it('returns null for completely malformed payloads', () => {
    expect(parsePsaSpecPopulation(null)).toBeNull()
    expect(parsePsaSpecPopulation(undefined)).toBeNull()
    expect(parsePsaSpecPopulation(42)).toBeNull()
    expect(parsePsaSpecPopulation('text')).toBeNull()
    // Object with no documented keys at all → null (never fabricate zeros)
    expect(parsePsaSpecPopulation({ foo: 1, bar: 2 })).toBeNull()
    // Envelope with PSAPop that has none of the documented keys → null
    expect(parsePsaSpecPopulation({ PSAPop: { nonsense: 1 } })).toBeNull()
  })

  it('does NOT fabricate total_graded when PSA omits Total', () => {
    const noTotal = {
      PSAPop: { Grade10: 100, Grade9: 200, Auth: 5 },
    }
    const parsed = parsePsaSpecPopulation(noTotal)!
    expect(parsed.psa_10).toBe(100)
    expect(parsed.psa_9).toBe(200)
    expect(parsed.auth).toBe(5)
    expect(parsed.total_graded).toBeNull()   // NO fallback sum — critical
    expect(parsed.gem_rate).toBeNull()        // no gem rate without a Total
  })

  it('missing grade values become null, not 0', () => {
    const partial = {
      PSAPop: { Total: 1000, Grade10: 10 },
    }
    const parsed = parsePsaSpecPopulation(partial)!
    expect(parsed.total_graded).toBe(1000)
    expect(parsed.psa_10).toBe(10)
    expect(parsed.psa_9).toBeNull()          // NOT 0
    expect(parsed.psa_1).toBeNull()          // NOT 0
    expect(parsed.auth).toBeNull()           // NOT 0
    // Gem rate still derived because Total>0 and Grade10 present
    expect(parsed.gem_rate).toBeCloseTo(1.0, 2)
  })

  it('non-numeric grade values become null, not 0', () => {
    const malformed = {
      PSAPop: { Total: 100, Grade10: 'oops', Grade9: null, Grade8: undefined, Grade7: 5 },
    }
    const parsed = parsePsaSpecPopulation(malformed)!
    expect(parsed.psa_10).toBeNull()
    expect(parsed.psa_9).toBeNull()
    expect(parsed.psa_8).toBeNull()          // key absent after undefined
    expect(parsed.psa_7).toBe(5)
  })

  it('qualified_total stays null when NO Grade*Q keys are present', () => {
    const noQ = {
      PSAPop: { Total: 100, Grade10: 10, Grade9: 20 },
    }
    const parsed = parsePsaSpecPopulation(noQ)!
    expect(parsed.qualified_total).toBeNull()
  })

  it('Total=0 is a legitimate factual zero and preserved', () => {
    const parsed = parsePsaSpecPopulation({ PSAPop: { Total: 0, Auth: 0 } })!
    expect(parsed.total_graded).toBe(0)
    expect(parsed.auth).toBe(0)
    expect(parsed.gem_rate).toBeNull()   // no Grade10, no gem rate
  })
})

describe('extractReturnedSpecId + extractDescription', () => {
  it('reads SpecID off the outer PSASpecPopulationModel', () => {
    expect(extractReturnedSpecId(FIXTURE_FULL_SWAGGER)).toBe('544023')
  })
  it('reads Description off the outer model', () => {
    expect(extractDescription(FIXTURE_FULL_SWAGGER)).toBe(
      'POKEMON BASE SET-UNLIMITED #2 BLASTOISE-HOLO',
    )
  })
  it('returns null for missing or non-string Description', () => {
    expect(extractDescription({ SpecID: 1 })).toBeNull()
    expect(extractDescription({ SpecID: 1, Description: 42 })).toBeNull()
  })
  it('returns null spec when missing', () => {
    expect(extractReturnedSpecId({})).toBeNull()
  })
})

describe('fetchPsaSpecPopulation — auth + validation', () => {
  const ORIG_TOKEN = process.env['PSA_PUBLIC_API_TOKEN']
  afterEach(() => {
    if (ORIG_TOKEN === undefined) delete process.env['PSA_PUBLIC_API_TOKEN']
    else process.env['PSA_PUBLIC_API_TOKEN'] = ORIG_TOKEN
  })

  it('returns unauthorized when token missing — no fetch issued', async () => {
    delete process.env['PSA_PUBLIC_API_TOKEN']
    let fetchCalled = false
    const stubFetch: typeof fetch = async () => { fetchCalled = true; return new Response('{}') }
    const r = await fetchPsaSpecPopulation('544023', { fetchImpl: stubFetch })
    expect(r.ok).toBe(false)
    expect(fetchCalled).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('unauthorized')
  })

  it('rejects non-numeric spec_id without issuing a fetch', async () => {
    process.env['PSA_PUBLIC_API_TOKEN'] = 'test-token'
    let fetchCalled = false
    const stubFetch: typeof fetch = async () => { fetchCalled = true; return new Response('{}') }
    const r = await fetchPsaSpecPopulation('abc', { fetchImpl: stubFetch })
    expect(r.ok).toBe(false)
    expect(fetchCalled).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('parse')
  })

  it('surfaces 401 as unauthorized with retry_after', async () => {
    process.env['PSA_PUBLIC_API_TOKEN'] = 'test-token'
    const stubFetch: typeof fetch = async () => new Response('unauthorized', {
      status: 401, headers: { 'retry-after': '300' },
    })
    const r = await fetchPsaSpecPopulation('123', { fetchImpl: stubFetch })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('unauthorized')
      expect(r.error.status).toBe(401)
      expect(r.error.retryAfterSeconds).toBe(300)
    }
  })

  it('surfaces 429 as rate_limited', async () => {
    process.env['PSA_PUBLIC_API_TOKEN'] = 'test-token'
    const stubFetch: typeof fetch = async () => new Response('slow down', {
      status: 429, headers: { 'retry-after': '60' },
    })
    const r = await fetchPsaSpecPopulation('123', { fetchImpl: stubFetch })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.kind).toBe('rate_limited')
      expect(r.error.retryAfterSeconds).toBe(60)
    }
  })

  it('rejects responses with a mismatching SpecID', async () => {
    process.env['PSA_PUBLIC_API_TOKEN'] = 'test-token'
    const stubFetch: typeof fetch = async () => new Response(
      JSON.stringify({ SpecID: 999999, PSAPop: { Total: 5, Grade10: 5 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    const r = await fetchPsaSpecPopulation('123', { fetchImpl: stubFetch })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('spec_mismatch')
  })

  it('rejects responses that parse to no documented keys (never writes a synthetic zero)', async () => {
    process.env['PSA_PUBLIC_API_TOKEN'] = 'test-token'
    const stubFetch: typeof fetch = async () => new Response(
      JSON.stringify({ SpecID: 123, Description: 'x', PSAPop: { nonsense: 1 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    const r = await fetchPsaSpecPopulation('123', { fetchImpl: stubFetch })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('parse')
  })

  it('accepts a well-formed Swagger-shape response and surfaces Description', async () => {
    process.env['PSA_PUBLIC_API_TOKEN'] = 'test-token'
    const stubFetch: typeof fetch = async () => new Response(
      JSON.stringify(FIXTURE_FULL_SWAGGER),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    const r = await fetchPsaSpecPopulation('544023', { fetchImpl: stubFetch })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.specId).toBe('544023')
      expect(r.description).toBe('POKEMON BASE SET-UNLIMITED #2 BLASTOISE-HOLO')
      expect(r.payload.psa_10).toBe(382)
      expect(r.payload.psa_1_5).toBe(10)
      expect(r.payload.auth).toBe(120)
      expect(r.payload.total_graded).toBe(48226)
      expect(r.payload.qualified_total).toBe(193)
      expect(r.payload.gem_rate).toBeCloseTo(0.79, 2)
    }
  })
})
