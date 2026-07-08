import { fileURLToPath } from 'node:url'
import cloudflare from '@astrojs/cloudflare'
import react from '@astrojs/react'
import { DEFAULT_LOCALE, LOCALES } from '@statusbeam/core'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// https://docs.astro.build/en/guides/integrations-guide/cloudflare/
export default defineConfig({
  // Server output so pages render at the edge from D1/KV. Fronted by Workers
  // Cache (see wrangler.jsonc) so hits skip the Worker entirely.
  output: 'server',
  adapter: cloudflare(),
  integrations: [react()],
  // URL-prefixed locales: /en/ /ja/ /ko/ /zh/, each a real page under
  // src/pages/<locale>/ rendering the shared StatusPage component. Every locale
  // is a distinct URL, so the edge cache never fragments on Accept-Language.
  // The bare `/` is handled by src/middleware.ts, which negotiates the visitor's
  // language (cookie → Accept-Language → config default) and redirects. Enabling
  // i18n here is what powers `Astro.preferredLocale`/`Astro.currentLocale`.
  // Locales come from core's `LOCALES` so the routing set can't drift from the
  // translation dictionaries / footer switcher.
  i18n: {
    locales: [...LOCALES],
    defaultLocale: DEFAULT_LOCALE,
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  },
})
