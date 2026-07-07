import pleaseai from '@pleaseai/eslint-config'

export default pleaseai({
  ignores: ['**/dist/**', '**/.astro/**', '**/.wrangler/**', '**/.impeccable/**', '**/worker-configuration.d.ts'],
})
