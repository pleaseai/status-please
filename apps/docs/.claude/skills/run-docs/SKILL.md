---
name: run-docs
description: Build, serve, smoke-test, and screenshot the StatusBeam docs site (apps/docs — Astro + Nimbus). Use when asked to run, preview, build, verify, or screenshot the documentation site, or to check its llms.txt / Markdown / AI endpoints.
allowed-tools: Bash, Read
---

# Run the StatusBeam docs site (`apps/docs`)

Static **Astro + Nimbus** documentation site. It builds to `./dist` and is
deployed to a Cloudflare **Pages** project (no server, no D1/KV) — served at
`docs.statusbeam.dev`, with bundled assets loaded from `statusbeam-docs.pages.dev`
(`build.assetsPrefix`). The agent surface — `/llms.txt`, `/llms-full.txt`,
per-section `/<section>/llms.txt`, per-page `index.md` and `index.mdx` twins, and
the "Copy page" / "View as Markdown" actions — is what most edits touch.

All paths below are relative to `apps/docs/`. Run commands from there.

## Agent path — build, then drive

The driver is [`.claude/skills/run-docs/driver.mjs`](./driver.mjs). It serves the
built `./dist` with `astro preview` and asserts the real HTTP surface: HTML,
site and section llms.txt files, a Markdown twin, an MDX source twin, rendered
MDX components, and the Nimbus page-action markup. Exit 0 = all green.

```bash
bun install            # once, from the repo root
bunx astro build       # produces ./dist (required before the driver)
node .claude/skills/run-docs/driver.mjs --port 4325
```

Expected tail:

```
✓ home renders  (/)
✓ llms.txt  (/llms.txt)
✓ llms-full.txt  (/llms-full.txt)
✓ section llms.txt  (/guides/llms.txt)
✓ markdown twin  (/guides/configuration/index.md)
✓ mdx twin  (/guides/configuration/index.mdx)
✓ mdx components render  (/guides/configuration/)
✓ page actions render  (/guides/configuration/)
✓ markdown action link  (/guides/configuration/)

PASS — docs site serves and all Nimbus endpoints are live.
```

Pick any free `--port` (default 4321). The driver starts and stops its own
preview server.

## Screenshot (visual proof)

The HTTP checks pass even when a page renders visibly wrong (see Gotchas), so for
UI changes take a screenshot too. Backend used this session: **`agent-browser`**
(no `chromium-cli` on this machine; inside Orca the embedded browser via the
`orca` CLI also works). Serve in the background, then capture:

```bash
bunx astro preview --port 4326 > /tmp/docs-preview.log 2>&1 &
sleep 6
agent-browser open http://localhost:4326/guides/configuration/
agent-browser wait --load networkidle
agent-browser screenshot page.png          # writes ./page.png (see Gotchas)
agent-browser close
pkill -f "astro preview"
```

Then `Read` the PNG to confirm it rendered. Reference shots in this directory may
show an earlier framework version; capture fresh images when visual proof matters.

## Human path

```bash
bunx astro dev        # http://localhost:4321 with hot reload
```

Useful for editing content; not needed for verification.

## Deploy

```bash
bun run --filter '@statusbeam/docs' deploy    # astro build && wrangler pages deploy --branch=main
```

Needs `CLOUDFLARE_API_TOKEN` (with **Cloudflare Pages: Edit**) + `CLOUDFLARE_ACCOUNT_ID`,
and the `statusbeam-docs` Pages project must already exist
(`bunx wrangler pages project create statusbeam-docs --production-branch main`). CI
does this via `.github/workflows/deploy-docs.yml` on merge to `main`.

## Gotchas

- **MDX components are global but registered.** Pages do not import `Aside`,
  `Steps`, `Card`, or the other Nimbus components. Every PascalCase component
  used in MDX must instead exist in `src/components.ts`; Nimbus's pre-build
  validator fails on unknown tags. The driver's rendered-component check catches
  a page that leaks MDX source instead of producing the Nimbus aside markup.
- **Two per-page twins serve different readers.** `/<page>/index.md` is clean,
  downleveled Markdown for ingestion. `/<page>/index.mdx` preserves the authored
  source. Nimbus page actions fetch and link to the Markdown twin.
- **Nimbus owns the agent index family.** `/llms.txt` is the overview,
  `/llms-full.txt` is the entire corpus, and `/<section>/llms.txt` narrows the
  index. Do not restore the removed Starlight plugins or `.md.txt` namespace.
- **`agent-browser screenshot <name>` output path varies.** Grab the path from the
  command output (or find the newest image under its screenshots directory)
  instead of assuming the destination.

## Troubleshooting

- `✗ ./dist not found` from the driver → run `bunx astro build` first.
- `✗ preview server never came up` → the port is busy; pass a different `--port`,
  or stop the stale `astro preview` process.
- Driver hangs / stale content → clear `dist` and `.astro`, then rebuild.
