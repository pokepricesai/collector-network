// CN-STOCK-01 · robots.txt gate.
//
// Minimal, deliberate robots.txt parser. Blocks the probe from
// fetching paths that the site has explicitly disallowed for *.
// Follows the subset of the standard we actually need:
//
//   * Matches the User-agent: * group (we identify as a generic
//     bot — we do NOT look for a stock-probe-specific group).
//   * Honours Disallow directives for path prefixes (leading /,
//     wildcard * at end).
//   * Honours Allow when it's more specific than a matching
//     Disallow (RFC 9309).
//   * Ignores Crawl-delay here; the fetch module enforces an
//     explicit per-host delay independently.
//
// Fail-CLOSED on robots.txt uncertainty (CN-STOCK-02 correction).
//
// The CN-STOCK-01 benchmark was a one-shot operator-supervised
// probe where a transient 5xx on robots.txt could reasonably
// be ignored. The CN-STOCK-02 scheduled polling engine operates
// unsupervised at 15-minute cadence, so any failed or uncertain
// robots.txt fetch MUST block the subsequent product fetch —
// never silently authorise automated polling against a host
// whose permissions we could not confirm.
//
// Decision table:
//   200 + parseable     → use rules
//   403                 → fail-closed (host refusing)
//   404 / 410           → fail-open (standard: no robots = allow)
//   any other (5xx,
//     network error,
//     timeout, 429,
//     redirect loop)    → fail-closed with explicit reason
//
// The product-fetch path records the gate decision as a
// `blocked` observation so the operator sees it in the Jobs
// run and in the admin stock dashboard.

import { fetchWithLimits } from './fetch.mjs'

const CACHE = new Map()          // hostname → { fetched_at, rules }

const USER_AGENT_IDENT = 'collectornetworkstockprobe'  // compared lowercased

export function clearRobotsCache() { CACHE.clear() }

export async function robotsAllows(url, hostAllowlist, options = {}) {
  const u = new URL(url)
  const host = u.hostname.toLowerCase()
  if (!hostAllowlist.has(host)) {
    return { allowed: false, reason: 'host not on allowlist', source: 'allowlist' }
  }
  const rules = await loadRules(host, u.protocol)
  if (rules.error) {
    // CN-STOCK-02: fail-CLOSED. An unsupervised poller must not
    // proceed when we cannot confirm the site's robots policy.
    // The benchmark script can override this via options.benchmarkFailOpen
    // for a supervised one-shot run; the scheduled engine never
    // passes that option.
    if (options.benchmarkFailOpen) {
      return { allowed: true, reason: `robots.txt unavailable (${rules.error}) — benchmark fail-open override`, source: 'fail_open' }
    }
    return { allowed: false, reason: `robots.txt unavailable (${rules.error}) — fail-closed; will retry next cycle`, source: 'robots_uncertain' }
  }
  if (rules.blocked) {
    return { allowed: false, reason: `robots.txt User-agent: * explicitly denies ${u.pathname}`, source: 'robots' }
  }
  const path = u.pathname + (u.search || '')
  const match = matchDirective(rules.directives, path)
  if (match && match.directive === 'disallow') {
    return { allowed: false, reason: `robots.txt Disallow: ${match.pattern}`, source: 'robots' }
  }
  return { allowed: true, reason: `robots.txt permits (${match ? `Allow: ${match.pattern}` : 'no matching directive'})`, source: 'robots' }
}

async function loadRules(host, protocol) {
  if (CACHE.has(host)) return CACHE.get(host)
  const robotsUrl = `${protocol}//${host}/robots.txt`
  const res = await fetchWithLimits(robotsUrl, { timeoutMs: 10_000, maxBytes: 128_000, skipAllowlist: true })
  let value
  if (!res.ok) {
    if (res.status === 403) {
      value = { blocked: true, directives: [], error: null }
    } else if (res.status === 404 || res.status === 410) {
      // No robots.txt → everything allowed by the standard.
      value = { blocked: false, directives: [], error: null }
    } else {
      value = { blocked: false, directives: [], error: res.error ?? `HTTP ${res.status}` }
    }
  } else {
    value = parseRobots(res.body)
  }
  CACHE.set(host, value)
  return value
}

/** Parse robots.txt. Returns { blocked, directives: [{directive, pattern}] }. */
export function parseRobots(txt) {
  if (typeof txt !== 'string') return { blocked: false, directives: [], error: null }
  const lines = txt.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean)
  const groups = []
  let current = null
  for (const line of lines) {
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.+)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'user-agent') {
      if (current) groups.push(current)
      current = { agents: [val.toLowerCase()], rules: [] }
      continue
    }
    if (!current) continue
    if (key === 'disallow' || key === 'allow') {
      current.rules.push({ directive: key, pattern: val })
    }
  }
  if (current) groups.push(current)

  // Find the most specific matching group: our ident > '*'.
  let matched = groups.find((g) => g.agents.includes(USER_AGENT_IDENT))
    ?? groups.find((g) => g.agents.includes('*'))
    ?? null
  if (!matched) return { blocked: false, directives: [], error: null }

  // If the matched group has only `Disallow: /` → blocked for everything.
  const allBlocked = matched.rules.length > 0
    && matched.rules.every((r) => r.directive === 'disallow' && (r.pattern === '/' || r.pattern === ''))
    && matched.rules.some((r) => r.pattern === '/')
  if (allBlocked) return { blocked: true, directives: [], error: null }

  return { blocked: false, directives: matched.rules, error: null }
}

/** Return the most-specific Allow/Disallow pattern that matches
 *  the given path. Specificity = pattern character length
 *  (RFC 9309 semantics). */
export function matchDirective(directives, path) {
  let best = null
  for (const rule of directives) {
    const pattern = rule.pattern
    if (!pattern) continue
    if (matchPattern(pattern, path)) {
      if (!best || pattern.length > best.pattern.length) best = rule
    }
  }
  return best
}

function matchPattern(pattern, path) {
  // Robots.txt supports a limited wildcard — * matches any sequence,
  // $ matches end-of-path. We implement it as a RegExp.
  const re = new RegExp(
    '^' +
    pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\\\$$/, '$') +
    (pattern.endsWith('$') ? '' : ''),
  )
  return re.test(path)
}
