import 'server-only';

// CN-STOCK-02 · robots.txt gate (TS port of scripts/_cn-stock-01/
// robots.mjs). Fail-CLOSED on any uncertain fetch; the scheduled
// engine never passes benchmarkFailOpen.

import { fetchWithLimits } from './fetch';

const CACHE: Map<string, LoadedRules> = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;  // 1 hour

interface LoadedRules {
  blocked: boolean;
  directives: Array<{ directive: 'allow' | 'disallow'; pattern: string }>;
  error: string | null;
  loaded_at: number;
}

export function clearRobotsCache(): void { CACHE.clear(); }

export interface GateResult {
  allowed: boolean;
  reason: string;
  source: 'allowlist' | 'robots' | 'robots_uncertain' | 'fail_open';
}

export async function robotsAllows(
  url: string,
  hostAllowlist: Set<string>,
  options: { benchmarkFailOpen?: boolean } = {},
): Promise<GateResult> {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  if (!hostAllowlist.has(host)) {
    return { allowed: false, reason: 'host not on allowlist', source: 'allowlist' };
  }
  const rules = await loadRules(host, u.protocol);
  if (rules.error) {
    if (options.benchmarkFailOpen) {
      return { allowed: true, reason: `robots.txt unavailable (${rules.error}) — benchmark fail-open override`, source: 'fail_open' };
    }
    return { allowed: false, reason: `robots.txt unavailable (${rules.error}) — fail-closed; will retry next cycle`, source: 'robots_uncertain' };
  }
  if (rules.blocked) {
    return { allowed: false, reason: `robots.txt User-agent: * explicitly denies ${u.pathname}`, source: 'robots' };
  }
  const path = u.pathname + (u.search || '');
  const match = matchDirective(rules.directives, path);
  if (match && match.directive === 'disallow') {
    return { allowed: false, reason: `robots.txt Disallow: ${match.pattern}`, source: 'robots' };
  }
  return { allowed: true, reason: `robots.txt permits (${match ? `Allow: ${match.pattern}` : 'no matching directive'})`, source: 'robots' };
}

async function loadRules(host: string, protocol: string): Promise<LoadedRules> {
  const cached = CACHE.get(host);
  if (cached && Date.now() - cached.loaded_at < CACHE_TTL_MS) return cached;
  const robotsUrl = `${protocol}//${host}/robots.txt`;
  const res = await fetchWithLimits(robotsUrl, { timeoutMs: 10_000, maxBytes: 128_000, skipAllowlist: true });
  let value: LoadedRules;
  if (!res.ok) {
    if (res.status === 403) {
      value = { blocked: true, directives: [], error: null, loaded_at: Date.now() };
    } else if (res.status === 404 || res.status === 410) {
      value = { blocked: false, directives: [], error: null, loaded_at: Date.now() };
    } else {
      value = { blocked: false, directives: [], error: res.error ?? `HTTP ${res.status}`, loaded_at: Date.now() };
    }
  } else {
    value = { ...parseRobots(res.body), loaded_at: Date.now() };
  }
  CACHE.set(host, value);
  return value;
}

export function parseRobots(txt: string): { blocked: boolean; directives: LoadedRules['directives']; error: string | null } {
  if (typeof txt !== 'string') return { blocked: false, directives: [], error: null };
  const lines = txt.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const groups: Array<{ agents: string[]; rules: LoadedRules['directives'] }> = [];
  let current: { agents: string[]; rules: LoadedRules['directives'] } | null = null;
  for (const line of lines) {
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === 'user-agent') {
      if (current) groups.push(current);
      current = { agents: [val.toLowerCase()], rules: [] };
      continue;
    }
    if (!current) continue;
    if (key === 'disallow' || key === 'allow') {
      current.rules.push({ directive: key, pattern: val });
    }
  }
  if (current) groups.push(current);
  const matched = groups.find((g) => g.agents.includes('*')) ?? null;
  if (!matched) return { blocked: false, directives: [], error: null };
  const allBlocked = matched.rules.length > 0
    && matched.rules.every((r) => r.directive === 'disallow' && (r.pattern === '/' || r.pattern === ''))
    && matched.rules.some((r) => r.pattern === '/');
  if (allBlocked) return { blocked: true, directives: [], error: null };
  return { blocked: false, directives: matched.rules, error: null };
}

export function matchDirective(directives: LoadedRules['directives'], path: string): LoadedRules['directives'][number] | null {
  let best: LoadedRules['directives'][number] | null = null;
  for (const rule of directives) {
    const pattern = rule.pattern;
    if (!pattern) continue;
    if (matchPattern(pattern, path)) {
      if (!best || pattern.length > best.pattern.length) best = rule;
    }
  }
  return best;
}

function matchPattern(pattern: string, path: string): boolean {
  const re = new RegExp(
    '^' +
    pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\\\$$/, '$'),
  );
  return re.test(path);
}
