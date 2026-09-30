import js from '@eslint/js'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Layer rules (PLAN §1.1):
 *   app → features → ui / lib → db → logic
 * Imports flow downward only. Each layer gets its own non-overlapping `files` glob so that
 * no-restricted-imports configs never override one another (flat config: last match wins per rule).
 */

const REACT = ['react', 'react/*', 'react-dom', 'react-dom/*', 'dexie-react-hooks']
const UI_LIBS = ['lucide-react', '@dnd-kit/*']

/** @param {string[]} group @param {string} message */
const ban = (group, message) => ({ group, message })

/** @param {string} regex @param {string} message */
const banRe = (regex, message) => ({ regex, message })

/** @param {Array<ReturnType<typeof ban> | ReturnType<typeof banRe>>} patterns @param {string[]} [paths] */
const restrictImports = (patterns, paths = []) => ({
  '@typescript-eslint/no-restricted-imports': [
    'error',
    {
      paths: paths.map((name) => ({ name, message: 'Not allowed in this layer (PLAN §1.1).' })),
      patterns,
    },
  ],
})

const noAppOrFeatures = [
  ban(['@/app', '@/app/*'], 'Lower layers must not import the app shell.'),
  ban(['@/features', '@/features/*'], 'Lower layers must not import features.'),
]

const logicRules = {
  ...restrictImports([
    ban(
      [...REACT, ...UI_LIBS, 'dexie', 'dexie/*'],
      'src/logic is pure: no React, Dexie or UI libraries.',
    ),
    banRe('^@/db(/(?!types$).*)?$', 'src/logic may only `import type` from @/db/types.'),
    ban(['@/ui', '@/ui/*', '@/lib', '@/lib/*'], 'src/logic must not import ui or lib.'),
    ...noAppOrFeatures,
  ]),
  'no-restricted-globals': [
    'error',
    ...['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'indexedDB'].map(
      (name) => ({ name, message: 'src/logic is pure: no DOM or browser globals.' }),
    ),
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
      message: 'Inject time as a parameter; do not call Date.now() in src/logic.',
    },
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: 'Inject time as a parameter; do not call new Date() in src/logic.',
    },
  ],
}

const featureBans = [
  ban(
    ['@/db/sync', '@/db/sync/*'],
    'Features reach sync only through @/db/repos/sync, @/db/repos/syncGate and @/db/hooks/useSyncState (PLAN §4.7.9).',
  ),
  ban(
    ['@/features/*/*', '@/features/*/**'],
    'Import other features only through their index.ts: @/features/<name>.',
  ),
  ban(
    [
      '@/app/layout',
      '@/app/layout/*',
      '@/app/palette',
      '@/app/palette/*',
      '@/app/boot',
      '@/app/start',
      '@/app/App',
      '@/app/registry/discover',
    ],
    'Features may use only the registry API (@/app/registry), router, shortcuts, hooks and providers of the app shell; the discovery module is internal.',
  ),
]

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'screenshots',
      'test-results',
      'playwright-report',
      'extension/dist',
      'node_modules',
      'dev-dist',
      'dist-*',
      'test-results-*',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  { rules: { 'no-console': 'error' } },

  // React (app + extension-free UI code)
  {
    ...reactHooks.configs.flat.recommended,
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  { ...jsxA11y.flatConfigs.recommended, files: ['src/**/*.{ts,tsx}'] },

  // logic: pure
  { files: ['src/logic/**/*.{ts,tsx}'], rules: logicRules },
  { files: ['src/logic/**/*.test.ts'], rules: { 'no-restricted-syntax': 'off' } },

  // db: no UI layers; React only inside db/hooks
  {
    files: ['src/db/**/*.{ts,tsx}'],
    ignores: ['src/db/hooks/**'],
    rules: restrictImports([
      ban(REACT, 'React is only allowed in src/db/hooks.'),
      ban(['@/ui', '@/ui/*'], 'src/db must not import ui.'),
      ...noAppOrFeatures,
    ]),
  },
  {
    files: ['src/db/hooks/**/*.{ts,tsx}'],
    rules: restrictImports([
      ban(['@/ui', '@/ui/*'], 'src/db must not import ui.'),
      ...noAppOrFeatures,
    ]),
  },

  // lib: browser helpers; below ui/features/app
  {
    files: ['src/lib/**/*.{ts,tsx}'],
    rules: restrictImports([
      ban(['@/ui', '@/ui/*'], 'src/lib must not import ui.'),
      banRe('^@/db(/(?!types$).*)?$', 'src/lib may only `import type` from @/db/types.'),
      ...noAppOrFeatures,
    ]),
  },

  // ui: no data access
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: restrictImports([
      ban(['@/db', '@/db/*'], 'src/ui has no data access.'),
      ban(['dexie', 'dexie/*', 'dexie-react-hooks'], 'src/ui has no data access.'),
      ...noAppOrFeatures,
    ]),
  },

  // features: deep imports into other features are banned; @/db/db only from queries.ts
  {
    files: ['src/features/**/*.{ts,tsx}'],
    ignores: ['src/features/**/queries.ts'],
    rules: restrictImports([
      ...featureBans,
      ban(
        ['@/db/db'],
        'Import the Dexie instance only in queries.ts; use repos and hooks elsewhere.',
      ),
    ]),
  },
  {
    files: ['src/features/**/queries.ts'],
    rules: restrictImports(featureBans),
  },

  // app: features are reached through the registry (import.meta.glob), never imported directly
  {
    files: ['src/app/**/*.{ts,tsx}'],
    rules: restrictImports([
      ban(['@/features', '@/features/*'], 'The app shell discovers features via import.meta.glob.'),
    ]),
  },

  // extension shared code: pure and dependency-free
  {
    files: ['extension/src/shared/**/*.ts'],
    rules: restrictImports([
      ban(['@/*'], 'extension/src/shared must not import from the app.'),
      ban(
        [...REACT, ...UI_LIBS, 'dexie', 'dexie/*', 'zod', 'date-fns', 'date-fns/*'],
        'Shared extension code has no dependencies.',
      ),
    ]),
  },
  {
    files: ['extension/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } },
  },

  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },

  // node-side files
  {
    files: ['*.{js,mjs,ts}', 'scripts/**/*.{mjs,ts}', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  { files: ['scripts/**/*.mjs', '*.mjs'], rules: { 'no-console': 'off' } },
)
