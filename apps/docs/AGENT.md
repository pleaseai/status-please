# This Nimbus docs site

Astro-based docs in the `@statusbeam/docs` Bun workspace. The `nimbus-docs` package handles content schemas, sidebar/TOC, MDX→markdown, build hooks, and the `nimbus` CLI. Everything in `src/` is yours to edit.

## File layout

```
astro.config.ts              # imports nimbus + defineNimbusConfig
src/
├── components.ts            # MDX globals registry — every component used in .mdx must be listed
├── components/              # AgentDirective, Header, Render + ui/<slug>/
├── content/
│   ├── docs/*.mdx
│   └── partials/*.mdx       # referenced via <Render file="..." />
├── content.config.ts        # registers docsCollection() + partialsCollection()
├── layouts/                 # BaseLayout (NimbusHead), DocsLayout (sidebar/TOC/breadcrumbs)
├── lib/cn.ts                # Tailwind className merger
├── pages/
│   ├── [...slug].astro
│   ├── [...slug]/index.md.ts   # per-page clean Markdown alternate
│   ├── [...slug]/index.mdx.ts  # per-page authored MDX source
│   ├── [section]/llms.txt.ts   # per-section agent index
│   ├── llms.txt.ts
│   ├── llms-full.txt.ts
│   ├── og.png.ts                # site-level OG card
│   ├── og/
│   │   ├── _og-card-config.ts   # shared OG theme tokens (underscore = not a route)
│   │   └── [...slug].ts         # per-page OG cards
│   └── robots.txt.ts
└── styles/                  # globals.css, prose.css
```

Cloudflare Pages deploys also have `wrangler.jsonc` at the workspace root. Run workspace commands from `apps/docs/`, or use `bun run --filter '@statusbeam/docs' <script>` from the monorepo root.

## Writing docs

Frontmatter validates against `docsSchema` (`nimbus-docs/schemas`). Required: `title`.

```mdx
---
title: My page
description: One-line summary.
---

Content here. The page H1 comes from `title` — don't repeat it in the body.

## Section heading
```

Rules:

- **Components must be PascalCase and registered in `src/components.ts`.** A pre-build validator catches typos with a "did you mean" hint.
- **Partials use `<Render file="..." />`.** Don't import `.mdx` directly. Shared content lives in `src/content/partials/<slug>.mdx`.
- **Icons use `astro-icon` + Phosphor.** `<Icon name="ph:<glyph>" class="w-4 h-4" />` from `astro-icon/components`. Glyphs: [phosphoricons.com](https://phosphoricons.com).
- **Don't remove `<AgentDirective />` from `BaseLayout.astro`.** It points agents at `/llms.txt`.

## Adding things

| Goal | Action |
|---|---|
| New doc page | Create `src/content/docs/<slug>.mdx`. Sidebar picks it up. |
| New partial | Create `src/content/partials/<slug>.mdx`. Use via `<Render file="<slug>" />`. |
| UI from registry | `bunx nimbus-docs add <slug>`. Register in `src/components.ts` if used in MDX. |
| Feature recipe | `bunx nimbus-docs add <feature-slug>`. Pipe the printed brief to your agent. |
| Custom page route | Add a file under `src/pages/`. |
| Custom OG style | Edit `src/pages/og/_og-card-config.ts`. |

List installable items: `bunx nimbus-docs list`.

## Audit this site

When asked to audit, walk the categories below. Emit findings as:

```
- [error|warn|info] FILE:LINE — what + why + fix.
```

End with `Summary: N errors, N warnings.`

- **Config** — `astro.config.ts` calls `nimbus(defineNimbusConfig({ ... }))`; `site` is set; `editPattern` (if set) contains `{path}`; `output:` matches the deploy target.
- **Content** — `content.config.ts` registers `docsCollection()` (and `partialsCollection()` if used); every `.mdx` is inside a registered collection; frontmatter validates.
- **Sidebar** — every sidebar ref resolves to a content entry; no orphans; no slug collisions.
- **MDX** — every PascalCase component in `*.mdx` is registered; every `<Render file=...>` resolves; code-fence languages are valid.
- **Routes** — `llms.txt.ts`, `robots.txt.ts`, `[...slug]/index.md.ts`, `og.png.ts`, `og/[...slug].ts` all exist.
- **Registry hygiene** — every `src/components/ui/<slug>/` is either MDX-registered or imported in `src/`; transitive deps (`lib/cn.ts`, etc.) exist.
- **AI surface** — `<AgentDirective />` renders in `BaseLayout.astro`; doc `<head>` has `<link rel="alternate" type="text/markdown" ...>`.
- **Search** — `data-pagefind-body` is on the docs main wrapper; after `bun run build`, `dist/pagefind/` exists with ≥1 indexed page.
- **Cloudflare** — `wrangler.jsonc` keeps the Pages deployment shape with `name`, `compatibility_date`, and `pages_build_output_dir = "./dist"`.

## Don't

- Hand-add components under `src/components/ui/` that exists in the nimbus-docs registry — use `nimbus-docs add` so deps resolve.
- Import `.mdx` files directly — use `<Render file="..." />`.
- Attach remark/rehype plugins via `mdx({ remarkPlugins })` — Sätteri silently drops them. Framework-side transformations run as content passes.
- Remove `<AgentDirective />` unless asked.
- Edit `src/components.ts` to bypass registration — if a component is used in `.mdx`, register it.

## Project home

[nimbus-docs.com](https://nimbus-docs.com)
