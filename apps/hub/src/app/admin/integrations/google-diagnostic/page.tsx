import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader } from '@/components/admin/admin-ui';
import { mintGoogleAccessToken } from '@/server/google/credentials';

export const dynamic = 'force-dynamic';

// Server-only Google WIF diagnostic. Mints a short-lived access token
// via Vercel OIDC → WIF → service-account impersonation, confirms a
// harmless downstream read (GSC property list), and reports the full
// chain state. Nothing sensitive is rendered — token is replaced with
// a hashed digest + expiry.

interface DiagnosticResult {
  stage: 'wif' | 'gsc' | 'ga4';
  ok: boolean;
  summary: string;
  detail?: unknown;
  error?: string;
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex.slice(0, 12)}…`;
}

async function runDiagnostic(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];
  let accessToken: string | null = null;
  // Stage 1 — WIF token mint
  try {
    const r = await mintGoogleAccessToken([
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/analytics.readonly',
    ]);
    accessToken = r.token;
    results.push({
      stage: 'wif',
      ok: true,
      summary: `Minted ${r.authMode} access token for ${r.serviceAccountEmail}`,
      detail: {
        auth_mode: r.authMode,
        service_account: r.serviceAccountEmail,
        project_id: r.projectId,
        token_hash: await hashToken(r.token),
        expires_at: r.expiresAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    results.push({
      stage: 'wif',
      ok: false,
      summary: 'WIF token mint failed',
      error: err instanceof Error ? err.message : String(err),
    });
    return results;
  }

  // Stage 2 — Harmless GSC read (list sites the SA has access to).
  // Returns empty before Luke grants GSC access; still proves the token
  // is valid against the Search Console API.
  try {
    const res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
      error?: { code?: number; message?: string };
    };
    if (!res.ok) {
      results.push({
        stage: 'gsc',
        ok: false,
        summary: `Search Console API returned HTTP ${res.status}`,
        error: body.error?.message ?? JSON.stringify(body).slice(0, 300),
      });
    } else {
      const entries = body.siteEntry ?? [];
      results.push({
        stage: 'gsc',
        ok: true,
        summary: entries.length === 0
          ? 'Search Console reachable. No properties yet — grant the service account access to each site.'
          : `Search Console reachable. ${entries.length} propert${entries.length === 1 ? 'y' : 'ies'} visible to the service account.`,
        detail: { sites: entries.map((e) => ({ siteUrl: e.siteUrl, permission: e.permissionLevel })) },
      });
    }
  } catch (err) {
    results.push({
      stage: 'gsc',
      ok: false,
      summary: 'Search Console reach test failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Stage 3 — GA4 metadata reach test. Admin API's accountSummaries
  // endpoint shows which GA4 properties the SA can see.
  try {
    const res = await fetch(
      'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const body = (await res.json().catch(() => ({}))) as {
      accountSummaries?: Array<{
        account?: string;
        displayName?: string;
        propertySummaries?: Array<{ property?: string; displayName?: string }>;
      }>;
      error?: { code?: number; message?: string };
    };
    if (!res.ok) {
      results.push({
        stage: 'ga4',
        ok: false,
        summary: `GA4 Admin API returned HTTP ${res.status}`,
        error: body.error?.message ?? JSON.stringify(body).slice(0, 300),
      });
    } else {
      const accounts = body.accountSummaries ?? [];
      const propertyCount = accounts.reduce(
        (n, a) => n + (a.propertySummaries?.length ?? 0),
        0,
      );
      results.push({
        stage: 'ga4',
        ok: true,
        summary: propertyCount === 0
          ? 'GA4 Admin API reachable. No properties yet — grant the service account access to each GA4 property.'
          : `GA4 Admin API reachable. ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'} visible to the service account.`,
        detail: {
          accounts: accounts.map((a) => ({
            account: a.displayName,
            properties: (a.propertySummaries ?? []).map((p) => ({
              property: p.property,
              displayName: p.displayName,
            })),
          })),
        },
      });
    }
  } catch (err) {
    results.push({
      stage: 'ga4',
      ok: false,
      summary: 'GA4 reach test failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return results;
}

export default async function GoogleDiagnosticPage() {
  const { admin, sb } = await requireAdmin('/admin/integrations/google-diagnostic');
  const sites = await listNetworkSites(sb);
  const results = await runDiagnostic();

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/integrations/google-diagnostic">
      <SectionHeader
        eyebrow="Diagnostics"
        title="Google credential diagnostic"
        description="End-to-end proof of Vercel OIDC → Workload Identity Federation → service-account impersonation → Google API reach. No credentials or tokens are rendered — only the hashed token digest and the service-account email."
      />
      {results.map((r, i) => (
        <Panel
          key={i}
          title={
            r.stage === 'wif' ? '1. Workload Identity Federation'
            : r.stage === 'gsc' ? '2. Search Console reach'
            : '3. GA4 reach'
          }
          eyebrow={r.ok ? 'Pass' : 'Fail'}
        >
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{
              padding: '10px 12px',
              borderRadius: 8,
              background: r.ok ? '#E7F3EC' : '#FBE5E7',
              border: `1px solid ${r.ok ? '#BBD9C5' : '#E8B1B7'}`,
              color: r.ok ? '#1C5E34' : '#8A1C27',
              fontSize: 13,
              fontWeight: 600,
            }}>
              {r.summary}
            </div>
            {r.error && (
              <pre style={{
                margin: 0,
                padding: 10,
                background: 'var(--admin-surface-strong)',
                border: '1px solid var(--admin-border)',
                borderRadius: 8,
                fontSize: 11.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'var(--admin-text-muted)',
              }}>{r.error}</pre>
            )}
            {r.detail != null && (
              <pre style={{
                margin: 0,
                padding: 10,
                background: 'var(--admin-surface-strong)',
                border: '1px solid var(--admin-border)',
                borderRadius: 8,
                fontSize: 11.5,
                maxHeight: 320,
                overflow: 'auto',
                color: 'var(--admin-text)',
              }}>{JSON.stringify(r.detail, null, 2)}</pre>
            )}
          </div>
        </Panel>
      ))}
    </AdminShell>
  );
}
