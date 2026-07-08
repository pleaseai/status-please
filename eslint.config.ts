import pleaseai from '@pleaseai/eslint-config'

export default pleaseai({
  ignores: ['**/dist/**', '**/.astro/**', '**/.wrangler/**', '**/.impeccable/**', 'apps/web/src/components/ui/**', '**/worker-configuration.d.ts'],
}, {
  files: ['**/package.json'],
  rules: {
    // The `files` array is order-sensitive: npm/bun apply include/exclude
    // patterns in sequence, so a negation (`!src/**/*.test.ts`) must come AFTER
    // the include it refines (`src`). Alphabetizing would move `!` first and
    // re-include the test files in the published tarball, so don't sort it.
    'jsonc/sort-array-values': 'off',
  },
})
