import { describe, it, expect, afterEach } from 'vitest'
import { parsePsaSpecPopulation, extractReturnedSpecId, fetchPsaSpecPopulation } from '../apiClient'

describe('parsePsaSpecPopulation — PascalCase fixture (documented PSAPop shape)', () => {
  it('maps PascalCase grades into normalised fields, computes gem_rate when missing', () => {
    const fixture = {
      PSAPop: {
        SpecID: '855610',
        Auth: 0,
        PSA1: 27, PSA1_5: 0,
        PSA2: 9,  PSA3: 10, PSA4: 28, PSA5: 75,
        PSA6: 131, PSA7: 164, PSA8: 315,
        PSA9: 263, PSA10: 72,
        TotalPop: 1094,
      },
    }
    const parsed = parsePsaSpecPopulation(fixture)
    expect(parsed).not.toBeNull()
    expect(parsed!.psa_10).toBe(72)
    expect(parsed!.psa_9).toBe(263)
    expect(parsed!.psa_1_5).toBe(0)
    expect(parsed!.total_graded).toBe(1094)
    expect(parsed!.gem_rate).toBeCloseTo(6.58, 1)
  })

  it('tolerates snake_case keys', () => {
    const parsed = parsePsaSpecPopulation({ psa_10: 5, psa_9: 10, total_graded: 15 })
    expect(parsed!.psa_10).toBe(5)
    expect(parsed!.psa_9).toBe(10)
    expect(parsed!.total_graded).toBe(15)
  })

  it('returns null for non-objects', () => {
    expect(parsePsaSpecPopulation(null)).toBeNull()
    expect(parsePsaSpecPopulation(42)).toBeNull()
  })

  it('computes total_graded from grade sum when API omits it', () => {
    const parsed = parsePsaSpecPopulation({ PSA10: 10, PSA9: 20, PSA8: 5 })
    expect(parsed!.total_graded).toBe(35)
  })
})

describe('extractReturnedSpecId', () => {
  it('reads SpecID off an envelope', () => {
    expect(extractReturnedSpecId({ PSAPop: { SpecID: '855610' } })).toBe('855610')
  })
  it('reads spec_id in snake_case', () => {
    expect(extractReturnedSpecId({ spec_id: '12345' })).toBe('12345')
  })
  it('returns null when missing', () => {
    expect(extractReturnedSpecId({})).toBeNull()
  })
})

describe('fetchPsaSpecPopulation — auth gating + response validation', () => {
  const ORIG_TOKEN = process.env['PSA_PUBLIC_API_TOKEN']
  afterEach(() => {
    if (ORIG_TOKEN === undefined) delete process.env['PSA_PUBLIC_API_TOKEN']
    else process.env['PSA_PUBLIC_API_TOKEN'] = ORIG_TOKEN
  })

  it('returns unauthorized error when token missing — no fetch issued', async () => {
    delete process.env['PSA_PUBLIC_API_TOKEN']
    let fetchCalled = false
    const stubFetch: typeof fetch = async () => { fetchCalled = true; return new Response('{}') }
    const r = await fetchPsaSpecPopulation('855610', { fetchImpl: stubFetch })
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

  it('rejects responses with a mismatching spec_id', async () => {
    process.env['PSA_PUBLIC_API_TOKEN'] = 'test-token'
    const stubFetch: typeof fetch = async () => new Response(
      JSON.stringify({ PSAPop: { SpecID: '999999', PSA10: 5, TotalPop: 5 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    const r = await fetchPsaSpecPopulation('123', { fetchImpl: stubFetch })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('spec_mismatch')
  })

  it('accepts a well-formed matching response', async () => {
    process.env['PSA_PUBLIC_API_TOKEN'] = 'test-token'
    const stubFetch: typeof fetch = async () => new Response(
      JSON.stringify({ PSAPop: { SpecID: '123', PSA10: 5, PSA9: 10, TotalPop: 15 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    const r = await fetchPsaSpecPopulation('123', { fetchImpl: stubFetch })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.specId).toBe('123')
      expect(r.payload.psa_10).toBe(5)
      expect(r.payload.psa_9).toBe(10)
      expect(r.payload.total_graded).toBe(15)
    }
  })
})
