// CN-STOCK-01 · bounded HTTP fetch.
//
// Wraps node fetch with the safety rails the brief requires:
//
//   * Explicit timeout (10s default)
//   * Response-size cap (2 MB default) enforced by streaming
//     reader — we abort rather than buffer a hostile response
//   * Host allowlist — private/internal destinations (RFC 1918,
//     loopback, link-local, metadata) hard-denied
//   * No redirect following to an off-allowlist host
//   * User-Agent identifying the project + contact
//   * No cookie storage, no credentials
//   * No logging of cookies / tokens / full bodies
//
// Never used to mutate (cart, checkout, auth). GET-only.

const USER_AGENT = 'CollectorNetwork-StockProbe/0.1 (+contact: lukejosephpierce@gmail.com)'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

export const PRIVATE_HOST_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^fe80:/i,
  /^::1$/,
  /^localhost$/i,
  /^metadata\.google\.internal$/i,
  /^169\.254\.169\.254$/,
]

function isPrivateHost(host) {
  return PRIVATE_HOST_PATTERNS.some((p) => p.test(host))
}

/** Low-level bounded fetch.
 *
 *  options:
 *    timeoutMs        — abort if the request takes longer
 *    maxBytes         — abort if the body exceeds this (we return
 *                       whatever has been read, flagged truncated)
 *    skipAllowlist    — robots.txt needs to fetch BEFORE the host
 *                       is approved by the manifest; this bypasses
 *                       the allowlist check (host is still subject
 *                       to private-IP guards)
 *    hostAllowlist    — Set<string> of allowed hostnames (lowercased)
 *
 *  Returns:
 *    { ok: true,  status, body, bytes, duration_ms, truncated, final_url }
 *    { ok: false, status: 0, error, duration_ms, final_url? } */
export async function fetchWithLimits(url, options = {}) {
  const start = Date.now()
  let urlObj
  try { urlObj = new URL(url) } catch {
    return { ok: false, status: 0, error: 'invalid URL', duration_ms: 0 }
  }
  const host = urlObj.hostname.toLowerCase()
  if (isPrivateHost(host)) {
    return { ok: false, status: 0, error: `private/internal host blocked: ${host}`, duration_ms: 0 }
  }
  if (!options.skipAllowlist) {
    const allow = options.hostAllowlist
    if (!allow || !(allow instanceof Set) || !allow.has(host)) {
      return { ok: false, status: 0, error: `host not on allowlist: ${host}`, duration_ms: 0 }
    }
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes  = options.maxBytes  ?? DEFAULT_MAX_BYTES
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(new Error('timeout')), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',  // we re-check allowlist on every redirect
      signal: ctl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/json,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
      },
    })

    // Manual redirect handling — allowlist-checked, max 3 hops.
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      clearTimeout(timer)
      const loc = res.headers.get('location')
      if (!loc) {
        return { ok: false, status: res.status, error: 'redirect without Location', duration_ms: Date.now() - start, final_url: url }
      }
      const nextUrl = new URL(loc, url).toString()
      const hops = (options._hops ?? 0) + 1
      if (hops > 3) {
        return { ok: false, status: res.status, error: 'too many redirects', duration_ms: Date.now() - start, final_url: nextUrl }
      }
      return await fetchWithLimits(nextUrl, { ...options, _hops: hops })
    }

    // Stream the body with size cap.
    const reader = res.body?.getReader?.()
    const chunks = []
    let bytes = 0
    let truncated = false
    if (reader) {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) {
          bytes += value.byteLength
          if (bytes > maxBytes) {
            truncated = true
            try { await reader.cancel() } catch { /* ignore */ }
            break
          }
          chunks.push(value)
        }
      }
    } else {
      // Stream-less fallback (Node < 18 shape); not expected on Node 24.
      const buf = Buffer.from(await res.arrayBuffer())
      bytes = buf.byteLength
      chunks.push(buf)
      if (bytes > maxBytes) truncated = true
    }
    clearTimeout(timer)

    const body = Buffer.concat(chunks.map((c) => c instanceof Uint8Array ? c : Buffer.from(c)))
      .toString('utf8')
    return {
      ok: res.ok,
      status: res.status,
      body,
      bytes,
      duration_ms: Date.now() - start,
      truncated,
      final_url: url,
    }
  } catch (err) {
    clearTimeout(timer)
    const isAbort = err?.name === 'AbortError'
    return {
      ok: false,
      status: 0,
      error: isAbort ? `timeout after ${timeoutMs}ms` : `fetch error: ${err?.message ?? String(err)}`,
      duration_ms: Date.now() - start,
    }
  }
}

/** Per-host politeness gate. Call before each fetch to ensure the
 *  configured delay has elapsed since the last request to this host. */
export class HostGate {
  constructor(delayMs = 1500) {
    this.delayMs = delayMs
    this.lastAt = new Map()  // host → ms timestamp
  }
  async wait(host) {
    const now = Date.now()
    const prev = this.lastAt.get(host) ?? 0
    const needed = this.delayMs - (now - prev)
    if (needed > 0) await new Promise((r) => setTimeout(r, needed))
    this.lastAt.set(host, Date.now())
  }
}
