// Dev-only surfaces (design lab, future debug views) are gated behind
// this flag so they never appear in production. In production builds
// the environment variable is baked at build time — flipping it later
// requires a redeploy, which is what we want.

export const YGO_DEV_TOOLS_ENABLED =
  process.env['NEXT_PUBLIC_YGO_DEV_TOOLS'] === '1';
