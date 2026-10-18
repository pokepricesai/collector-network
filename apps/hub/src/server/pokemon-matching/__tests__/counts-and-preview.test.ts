import { describe, it, expect, vi } from 'vitest';
import { fetchStatusCounts } from '../queries';

// Regression tests for the "1,000 rows currently…" display bug in
// the Pokémon Matching workbench. Root cause: fetchStatusCounts
// previously ran `.select('pricing_eligibility, review_status')`
// without `count/head`, so PostgREST silently truncated at its
// default max_rows=1000 cap and local counting produced capped
// numbers. The fix uses `select(id, { count: 'exact', head: true })`
// per bucket which returns the real count regardless of max_rows.

// We stub the Supabase client. Each stubbed count query records the
// filter chain it was constructed with and returns the count the
// test case specifies. This gives us a reliable harness for asserting
// that the real counts flow through to StatusCounts.

type QueryResult = { count: number; data?: unknown; error?: null | { message: string } };

interface CountExpectation {
  // ordered filter matchers: ['provider','tcggraph'], ['review_status','pending_review'], …
  filters: Array<[string, string]>;
  nots?: Array<[string, string, string]>;
  count: number;
}

function makeStubbedSupabase(expectations: CountExpectation[]) {
  let callIndex = 0;
  const seen: Array<{ filters: Array<[string, string]>; nots: Array<[string, string, string]>; head: boolean }> = [];
  const stub = {
    from(_table: string) {
      const trace: { filters: Array<[string, string]>; nots: Array<[string, string, string]>; head: boolean } = { filters: [], nots: [], head: false };
      const q: any = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.head) trace.head = true;
          return q;
        },
        eq(col: string, val: unknown) {
          trace.filters.push([col, String(val)]);
          return q;
        },
        not(col: string, op: string, val: unknown) {
          trace.nots.push([col, op, String(val)]);
          return q;
        },
        then(resolve: (r: QueryResult) => void) {
          // When awaited, pick the next expectation and resolve.
          seen.push(trace);
          const expected = expectations[callIndex++];
          if (!expected) {
            resolve({ count: 0, error: { message: `unexpected extra query ${callIndex}` } });
            return;
          }
          resolve({ count: expected.count, data: null, error: null });
        },
      };
      return q;
    },
  };
  return { stub, seen };
}

describe('fetchStatusCounts — PostgREST max_rows=1000 regression', () => {
  it('issues head-count queries per bucket (never pulls a row payload)', async () => {
    // Expected queries in Promise.all order inside fetchStatusCounts:
    //  1. total count (just provider filter)
    //  2. verified_pending_bulk (provider + status + confidence)
    //  3-7. by eligibility (5 head counts, provider + elig filter)
    //  8-12. elig pending (5 head counts, provider + status + elig)
    //  13-18. by status (6 head counts, provider + status)
    const total = 60_689;
    const verifiedPending = 21_568 + 14_659 + 7_539;    // sum of pending across elig
    const eligFull = { bulk_safe: 21_568, market_only: 14_659, identity_only: 7_539, not_eligible: 4_266, uncertain: 12_657 };
    const eligPending = { bulk_safe: 21_568, market_only: 14_659, identity_only: 7_539, not_eligible: 0, uncertain: 12_657 };
    const byStatus = { unmatched: 4_266, pending_review: 56_423, approved: 0, rejected: 0, no_tcg_equivalent: 0, needs_price_verification: 0 };

    const expectations: CountExpectation[] = [
      { filters: [['provider','tcggraph']], count: total },
      { filters: [['provider','tcggraph'],['review_status','pending_review'],['confidence','verified']], count: verifiedPending },
      ...(['bulk_safe','market_only','identity_only','not_eligible','uncertain'] as const).map(e => ({ filters: [['provider','tcggraph'] as [string,string], ['pricing_eligibility', e] as [string,string]], count: eligFull[e] })),
      ...(['bulk_safe','market_only','identity_only','not_eligible','uncertain'] as const).map(e => ({ filters: [['provider','tcggraph'] as [string,string], ['review_status','pending_review'] as [string,string], ['pricing_eligibility', e] as [string,string]], count: eligPending[e] })),
      ...(['unmatched','pending_review','approved','rejected','no_tcg_equivalent','needs_price_verification'] as const).map(s => ({ filters: [['provider','tcggraph'] as [string,string], ['review_status', s] as [string,string]], count: byStatus[s] })),
    ];
    const { stub, seen } = makeStubbedSupabase(expectations);

    const result = await fetchStatusCounts(stub as any);

    // Every stub call must have been a head-count query.
    expect(seen.length).toBeGreaterThanOrEqual(expectations.length);
    for (const call of seen) {
      expect(call.head).toBe(true);
    }

    // Verified real counts came through, NOT clamped to 1000.
    expect(result.total).toBe(60_689);
    expect(result.bulk_safe_pending).toBe(21_568);
    expect(result.market_only_pending).toBe(14_659);
    expect(result.identity_only_pending).toBe(7_539);
    expect(result.verified_pending_bulk).toBe(verifiedPending);
    expect(result.by_pricing_eligibility.bulk_safe).toBe(21_568);
    expect(result.by_pricing_eligibility.uncertain).toBe(12_657);
    expect(result.by_status.pending_review).toBe(56_423);
    expect(result.by_status.unmatched).toBe(4_266);
  });

  it('never relies on a numeric value equal to 1000 as a signal of success', async () => {
    // Guard: if PostgREST ever returns a capped count = 1000, we must
    // still correctly report it, not silently promote it. This is a
    // documentation test — asserting that fetchStatusCounts does not
    // special-case 1000 anywhere.
    const query = (filters: Array<[string,string]>): CountExpectation => ({ filters, count: 1000 });
    const expectations: CountExpectation[] = [
      { filters: [], count: 1000 },
      { filters: [], count: 1000 },
      ...Array.from({ length: 5 }, () => query([])),
      ...Array.from({ length: 5 }, () => query([])),
      ...Array.from({ length: 6 }, () => query([])),
    ];
    const { stub } = makeStubbedSupabase(expectations);
    const result = await fetchStatusCounts(stub as any);
    expect(result.total).toBe(1000);
    expect(result.bulk_safe_pending).toBe(1000);
  });
});
