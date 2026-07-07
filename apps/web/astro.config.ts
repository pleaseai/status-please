import cloudflare from '@astrojs/cloudflare'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// https://docs.astro.build/en/guides/integrations-guide/cloudflare/
export default defineConfig({
  // Server output so pages render at the edge from D1/KV. Fronted by Workers
  // Cache (see wrangler.jsonc) so hits skip the Worker entirely.
  output: 'server',
  adapter: cloudflare(),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
})
