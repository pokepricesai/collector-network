// Dev-only surfaces (design lab, future debug views) are gated behind
// this SERVER-ONLY flag so they never appear in production and never
// leak into the client bundle. In production builds the environment
// variable is baked at server-process start — flipping it requires a
// redeploy, which is what we want.
//
// This module must not be imported into any 'use client' file.

export const YGO_DEV_TOOLS_ENABLED = process.env['YGO_DEV_TOOLS'] === '1';
