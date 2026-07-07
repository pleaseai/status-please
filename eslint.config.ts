import pleaseai from '@pleaseai/eslint-config'

export default pleaseai({
  ignores: ['**/dist/**', '**/.astro/**', '**/.wrangler/**', '**/.impeccable/**', 'apps/web/src/components/ui/**', '**/worker-configuration.d.ts'],
})
