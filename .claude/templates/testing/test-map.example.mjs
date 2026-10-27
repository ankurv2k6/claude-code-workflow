/**
 * Example test map. Copy to `context/testing/test-map.mjs` and replace every entry.
 * See ./README.md for what each export is for and the traps a selector must handle.
 */

/** How to invoke each test config. "The whole suite" means every runner. */
export const runners = {
  root: { cwd: '.', run: 'npx vitest run', related: 'npx vitest related --run', needsDb: true },
  web: { cwd: 'apps/web', run: 'npx vitest run', related: 'npx vitest related --run', needsDb: false },
};

/** What a database-backed suite needs before it can pass (fresh DB per lane). */
export const bootstrap = {
  script: 'scripts/test-bootstrap.sh',
  steps: ['migrate', 'seed reference data'],
};

/** Every test file belongs to exactly one group. `observes` = the source it can fail on. */
export const groups = [
  {
    id: 'api',
    runner: 'root',
    tests: ['apps/api/**/*.test.ts'],
    observes: ['apps/api/src/**'],
    dependents: ['web'],
  },
  {
    id: 'web',
    runner: 'web',
    tests: ['apps/web/**/*.test.{ts,tsx}'],
    observes: ['apps/web/src/**'],
    dependents: [],
  },
];

/** Tests that read a path without importing it. The import graph cannot see these. */
export const edges = [
  { test: 'apps/web/src/theme/__tests__/tokens.test.ts', reads: ['design/mockups/shared/css/**'] },
];

/** Changes that make narrow selection dishonest, and the tier they raise to. */
export const escalations = [
  { match: ['package-lock.json', 'pnpm-lock.yaml'], tier: 'full', why: 'dependency change' },
  { match: ['vitest.config.*', 'apps/web/vitest.config.*'], tier: 'full', why: 'harness change' },
  { match: ['packages/contracts/src/**'], tier: 'standard', why: 'shared contract' },
];

/** quick = related tests of changed files; standard = affected groups + dependents; full = all runners. */
export const tiers = ['quick', 'standard', 'full'];
