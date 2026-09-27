// .eslintrc.cjs
// Minimal, low-noise ESLint setup for the Next 16 + TypeScript codebase.
// next lint is removed in Next.js 16, so the project uses eslint directly.
//
// Rule philosophy
//   * Only enable rules that catch correctness issues. Stylistic rules
//     are intentionally OFF; the repository does not use prettier and
//     opening a 30k-line stylistic firehose would block useful signal.
//   * react-hooks rules of hooks are on — they have caused real bugs.
//   * TS @ts-expect-error must be used over @ts-ignore so dead
//     suppressions surface.
//   * no-unused-vars is a warning, not an error, to keep the first run
//     actionable rather than blocking.
//   * Local guard: warns if a client component reads a known server-only
//     env name. The catalogue lives in src/lib/env.ts; here we keep the
//     pattern list narrow and obvious.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  env: { browser: true, node: true, es2022: true },
  ignorePatterns: [
    'node_modules/',
    '.next/',
    'coverage/',
    'public/',
    'supabase/functions/**',           // Deno runtime; checked separately.
    'pokeprices-chat-edge-function.ts',// Legacy root copy of the edge fn.
    'next-env.d.ts',
    'tsconfig.tsbuildinfo',
    'response.html',
    'response2.html',
    'seo/',                            // Untracked dev scripts.
    'scripts/verify-*.mjs',            // Long-form Node scripts, separately reviewed.
  ],
  rules: {
    // Correctness
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/ban-ts-comment': ['warn', {
      'ts-ignore':       'allow-with-description',
      'ts-expect-error': false,
      'ts-nocheck':      'allow-with-description',
      'ts-check':        false,
    }],
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern:         '^_',
      varsIgnorePattern:         '^_',
      caughtErrorsIgnorePattern: '^_',
    }],

    // Obvious footguns
    'no-eval':                    'error',
    'no-implied-eval':            'error',
    'no-new-func':                'error',
    'no-script-url':              'error',
    'no-template-curly-in-string':'warn',

    // Block a small set of server-only secret names from being read in
    // files that look client-side. Pattern is narrow on purpose; the
    // canonical guard is `import 'server-only'`, this just catches loud
    // accidents during PR review.
    'no-restricted-syntax': [
      'warn',
      {
        selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^(SUPABASE_SERVICE_ROLE_KEY|ALERTS_TRIGGER_SECRET|CLAUDE_API_KEY|OPENAI_API_KEY|GOOGLE_VISION_API_KEY|RESEND_API_KEY|VENDOR_DAILY_IP_SALT|ADMIN_ALLOWED_EMAILS)$/]",
        message: 'Server-only env var. Make sure this file imports "server-only" or routes through src/lib/env.ts.',
      },
    ],
  },
  overrides: [
    // Tests get extra leeway.
    {
      files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-unused-vars': 'off',
        'no-restricted-syntax': 'off',
      },
    },
    // Config files in CommonJS.
    {
      files: ['*.cjs', '*.config.js', 'postcss.config.js', 'next.config.js', 'tailwind.config.js'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        'no-restricted-syntax': 'off',
      },
    },
  ],
}
