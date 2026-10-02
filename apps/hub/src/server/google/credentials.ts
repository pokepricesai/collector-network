import 'server-only';

// Collector Network OS — shared Google credential provider.
//
// Three environments, three outcomes:
//
//   VERCEL PRODUCTION (VERCEL === '1' AND VERCEL_ENV === 'production')
//     Vercel OIDC token
//       → Google Security Token Service (STS)
//       → Workload Identity Federation (pool=vercel-cn, provider=vercel-cn)
//       → SA impersonation (cn-os-analytics@collector-network-os…)
//       → Google APIs (GSC / GA4 Data API / BigQuery)
//
//     The WIF provider's attribute condition is EXACT MATCH on
//       owner:lukepierce:project:collector-network:environment:production
//     so Vercel preview / development OIDC tokens cannot federate.
//
//   VERCEL PREVIEW / DEVELOPMENT
//     Fails closed. We surface a clear error rather than let the WIF
//     exchange produce a confusing STS PermissionDenied downstream.
//
//   LOCAL DEV (VERCEL not set)
//     Application Default Credentials (`gcloud auth application-default
//     login` once). Production security is NOT weakened — this path is
//     unreachable on Vercel.
//
// NEVER store a service-account JSON key in any env var. The WIF chain
// is the only accepted credential path. The design mirrors PokePrices'
// proven pattern but uses an entirely separate GCP project, pool,
// provider and service account — the Vercel OIDC trust is bound to the
// collector-network Vercel project, not pokeprices-web.

import type { AuthClient } from 'google-auth-library';

export interface GoogleAuthContext {
  authClient: AuthClient;
  authMode:
    | 'vercel-wif-production'
    | 'adc-local';
  projectId: string;
  serviceAccountEmail: string;
}

const WIF_SUBJECT_PRODUCTION =
  'owner:lukepierce:project:collector-network:environment:production';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[cn/google] ${name} env var is not set`);
  return v;
}

export async function makeGoogleAuth(): Promise<GoogleAuthContext> {
  const IS_VERCEL = process.env['VERCEL'] === '1';
  const VERCEL_ENV = process.env['VERCEL_ENV'] ?? null;
  const IS_VERCEL_PRODUCTION = IS_VERCEL && VERCEL_ENV === 'production';

  if (IS_VERCEL && !IS_VERCEL_PRODUCTION) {
    throw new Error(
      `[cn/google] Vercel environment '${VERCEL_ENV}' is not authorised for ` +
      `Google access. The WIF provider trusts only the exact subject ` +
      `'${WIF_SUBJECT_PRODUCTION}'. Preview / development deployments cannot ` +
      `federate — this is intentional. Run analytics work from Production.`,
    );
  }

  if (IS_VERCEL_PRODUCTION) {
    const PROJECT_ID = need('GCP_PROJECT_ID');
    const PROJECT_NUMBER = need('GCP_PROJECT_NUMBER');
    const POOL_ID = need('GCP_WORKLOAD_IDENTITY_POOL_ID');
    const PROVIDER_ID = need('GCP_WORKLOAD_IDENTITY_PROVIDER_ID');
    const SA_EMAIL = need('GCP_SERVICE_ACCOUNT_EMAIL');

    const { getVercelOidcToken } = await import('@vercel/oidc');
    const { ExternalAccountClient } = await import('google-auth-library');

    // ExternalAccountClient.fromJSON expects a specific JSON shape; cast
    // bridges the structural typing. The subject_token_supplier is
    // invoked LAZILY by google-auth-library each time STS needs a fresh
    // subject token, so the Vercel OIDC fetch happens per-request, not
    // at module init.
    const authClient = (ExternalAccountClient as unknown as {
      fromJSON: (json: Record<string, unknown>) => AuthClient;
    }).fromJSON({
      type: 'external_account',
      audience:
        `//iam.googleapis.com/projects/${PROJECT_NUMBER}` +
        `/locations/global/workloadIdentityPools/${POOL_ID}` +
        `/providers/${PROVIDER_ID}`,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      token_url: 'https://sts.googleapis.com/v1/token',
      service_account_impersonation_url:
        `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts` +
        `/${SA_EMAIL}:generateAccessToken`,
      subject_token_supplier: {
        getSubjectToken: async () => {
          const token = await getVercelOidcToken();
          if (!token) throw new Error('[cn/google] Vercel OIDC token is empty');
          return token;
        },
      },
    });

    return {
      authClient,
      authMode: 'vercel-wif-production',
      projectId: PROJECT_ID,
      serviceAccountEmail: SA_EMAIL,
    };
  }

  // Local dev — Application Default Credentials.
  const { GoogleAuth } = await import('google-auth-library');
  const PROJECT_ID = process.env['GCP_PROJECT_ID'] ?? 'collector-network-os';
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform.read-only'],
  });
  const authClient = await auth.getClient();
  return {
    authClient: authClient as AuthClient,
    authMode: 'adc-local',
    projectId: PROJECT_ID,
    serviceAccountEmail:
      process.env['GCP_SERVICE_ACCOUNT_EMAIL'] ?? '(adc)',
  };
}

/** Mint a short-lived Google access token for the service account. The
 *  caller never sees the OIDC subject token or the SA private key — the
 *  WIF chain handles that internally. */
export async function mintGoogleAccessToken(scopes?: string[]): Promise<{
  token: string;
  expiresAt: Date | null;
  authMode: GoogleAuthContext['authMode'];
  serviceAccountEmail: string;
  projectId: string;
}> {
  const ctx = await makeGoogleAuth();
  const extClient = ctx.authClient as unknown as {
    scopes?: string | string[];
    getAccessToken: () => Promise<{ token?: string | null; res?: { data?: { expires_in?: number } } }>;
  };
  if (scopes && scopes.length > 0) {
    extClient.scopes = scopes;
  }
  const resp = await extClient.getAccessToken();
  if (!resp.token) {
    throw new Error('[cn/google] access-token response had no token');
  }
  const expiresIn = resp.res?.data?.expires_in ?? null;
  return {
    token: resp.token,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    authMode: ctx.authMode,
    serviceAccountEmail: ctx.serviceAccountEmail,
    projectId: ctx.projectId,
  };
}
