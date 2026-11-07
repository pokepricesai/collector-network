// CN-DISCORD-01 · minimal Discord Guild Members REST client.
//
// Only the three endpoints the role-sync reconcile loop needs:
//   • GET    /guilds/{guild}/members/{user}         — read current roles
//   • PUT    /guilds/{guild}/members/{user}/roles/{role_id}  — add role
//   • DELETE /guilds/{guild}/members/{user}/roles/{role_id}  — remove role
//
// Design notes:
//   - The client is a tiny interface so reconcile.ts can be fully
//     unit-tested against a mock without touching discord.com.
//   - 429 handling retries once after honoring the Retry-After
//     header. Subsequent 429s surface as `error_429` to the caller
//     so the engine can give up on this user and log, rather than
//     spinning in a hot loop.
//   - 404 on getGuildMember means the user has not joined the
//     guild; reconcile skips them with `skip_not_in_guild`.
//   - No bulk mutation. Discord has no "set roles atomically"
//     endpoint that doesn't overwrite everything else, so we emit
//     one PUT or DELETE at a time.
//
// The real client is NOT constructed in tests; tests inject a mock
// that implements the same shape.

export type DiscordMember = {
  user_id: string;
  role_ids: string[];
};

export type DiscordResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'not_in_guild' | 'forbidden' | 'rate_limited' | 'other'; status: number; detail: string };

export interface DiscordClient {
  getGuildMember(guildId: string, userId: string): Promise<DiscordResult<DiscordMember>>;
  addGuildMemberRole(guildId: string, userId: string, roleId: string): Promise<DiscordResult<null>>;
  removeGuildMemberRole(guildId: string, userId: string, roleId: string): Promise<DiscordResult<null>>;
}

type FetchLike = typeof fetch;

export interface CreateDiscordClientOptions {
  token: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  // Max wait in ms we'll honor from a 429 Retry-After. Bounded so
  // a pathological response can't freeze a 300s cron. Defaults to
  // 5 seconds.
  maxRetryAfterMs?: number;
}

export function createRealDiscordClient(opts: CreateDiscordClientOptions): DiscordClient {
  const baseUrl = opts.baseUrl ?? 'https://discord.com/api/v10';
  const fetchImpl: FetchLike = opts.fetchImpl ?? fetch;
  const maxRetryAfterMs = opts.maxRetryAfterMs ?? 5000;
  const headers = {
    'Authorization': `Bot ${opts.token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'CollectorNetworkHub (cn-discord-01, 0.1.0)',
  };

  async function request<T>(
    method: 'GET' | 'PUT' | 'DELETE',
    path: string,
    parseJson: boolean,
    _retried: boolean = false,
  ): Promise<DiscordResult<T>> {
    const res = await fetchImpl(baseUrl + path, { method, headers });
    if (res.status === 429 && !_retried) {
      const raw = res.headers.get('retry-after');
      const seconds = raw ? Number(raw) : 1;
      const ms = Number.isFinite(seconds) ? Math.min(seconds * 1000, maxRetryAfterMs) : 1000;
      await new Promise((r) => setTimeout(r, ms));
      return request(method, path, parseJson, true);
    }
    if (res.status === 429) {
      return { ok: false, code: 'rate_limited', status: 429, detail: 'rate_limited_after_retry' };
    }
    if (res.status === 404) {
      return { ok: false, code: 'not_in_guild', status: 404, detail: 'member not in guild' };
    }
    if (res.status === 403) {
      return { ok: false, code: 'forbidden', status: 403, detail: 'bot lacks permission' };
    }
    if (res.status >= 200 && res.status < 300) {
      if (!parseJson) return { ok: true, value: null as unknown as T };
      const body = await res.json().catch(() => ({}));
      return { ok: true, value: body as T };
    }
    const text = await res.text().catch(() => '');
    return { ok: false, code: 'other', status: res.status, detail: text.slice(0, 200) };
  }

  return {
    async getGuildMember(guildId, userId) {
      type Raw = { user?: { id?: string }; roles?: unknown };
      const res = await request<Raw>('GET', `/guilds/${guildId}/members/${userId}`, true);
      if (!res.ok) return res;
      const roles = Array.isArray(res.value.roles)
        ? res.value.roles.filter((r): r is string => typeof r === 'string')
        : [];
      return {
        ok: true,
        value: { user_id: res.value.user?.id ?? userId, role_ids: roles },
      };
    },
    async addGuildMemberRole(guildId, userId, roleId) {
      return request<null>('PUT', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, false);
    },
    async removeGuildMemberRole(guildId, userId, roleId) {
      return request<null>('DELETE', `/guilds/${guildId}/members/${userId}/roles/${roleId}`, false);
    },
  };
}
