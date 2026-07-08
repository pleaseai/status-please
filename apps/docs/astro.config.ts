import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import starlightLlmsTxt from 'starlight-llms-txt'
import starlightMdTxt from 'starlight-md-txt'
import starlightPageActions from 'starlight-page-actions'

// StatusBeam documentation — static Astro + Starlight site.
// Deployed to Cloudflare via Workers Static Assets (see wrangler.jsonc): the
// build is fully static, so no server adapter is needed.
// https://starlight.astro.build/
export default defineConfig({
  // Absolute base URL. Required so the AI-friendly outputs emit absolute links:
  // starlight-llms-txt (llms.txt / llms-full.txt), the sitemap, and the
  // "Open in ChatGPT/Claude" page actions (which pass `Astro.url.href`).
  site: 'https://docs.statusbeam.dev',
  integrations: [
    starlight({
      title: 'StatusBeam',
      description:
        'Open-source, CDN-native status page generator — a modern successor to upptime.',
      logo: { src: './src/assets/logo.svg', alt: 'StatusBeam' },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/pleaseai/statusbeam',
        },
      ],
      editLink: {
        baseUrl:
          'https://github.com/pleaseai/statusbeam/edit/main/apps/docs/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Configuration', slug: 'guides/configuration' },
            { label: 'Deploy to Cloudflare', slug: 'guides/deployment' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'AI & LLM endpoints', slug: 'reference/ai-and-llms' },
          ],
        },
      ],
      plugins: [
        // Emits /llms.txt (structured overview) and /llms-full.txt (the whole
        // site concatenated) for LLM ingestion. https://github.com/delucis/starlight-llms-txt
        starlightLlmsTxt({
          projectName: 'StatusBeam',
          description:
            'Open-source, CDN-native status page generator — a modern successor to upptime. Runs on Cloudflare (Workers, Cron Triggers, D1, KV).',
        }),
        // Exposes every page as clean, AST-transformed raw Markdown for agents
        // and crawlers. Pinned to `.md.txt` so it owns a namespace distinct from
        // the `.md` files that starlight-page-actions copies for its Copy button
        // (the plugin's own default is `.md`, which would collide).
        // https://github.com/max-ostapenko/starlight-md-txt
        starlightMdTxt({ format: '.md.txt' }),
        // Adds a "Copy Markdown" button and an "Open in ChatGPT / Claude / …"
        // dropdown to each page. We intentionally do NOT set `baseUrl` here:
        // that keeps the plugin from also writing its own llms.txt (which would
        // collide with starlight-llms-txt above). The AI actions use the page's
        // absolute URL from `site`, so they still work.
        // https://github.com/dlcastillop/starlight-page-actions
        starlightPageActions({
          actions: {
            chatgpt: true,
            claude: true,
            cursor: true,
            markdown: true,
          },
        }),
      ],
    }),
  ],
})
