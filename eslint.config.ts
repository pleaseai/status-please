import pleaseai from '@pleaseai/eslint-config'

export default pleaseai({
  ignores: ['**/dist/**', '**/.astro/**', '**/.wrangler/**', '**/.impeccable/**', '**/components/ui/**', '**/worker-configuration.d.ts'],
})
