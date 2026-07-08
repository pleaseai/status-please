---
name: run-docs
description: Build, serve, smoke-test, and screenshot the StatusBeam docs site (apps/docs — Astro + Starlight). Use when asked to run, preview, build, verify, or screenshot the documentation site, or to check its llms.txt / markdown / AI endpoints.
allowed-tools: Bash, Read
---

# Run the StatusBeam docs site (`apps/docs`)

Static **Astro + Starlight** documentation site. It builds to `./dist` and is
served on Cloudflare via Workers Static Assets (no server, no D1/KV). The AI
surface — `/llms.txt`, `/llms-full.txt`, per-page `.md.txt` raw Markdown, and the
"Copy Markdown" / "Open in ChatGPT·Claude" buttons — is what most edits touch.

All paths below are relative to `apps/docs/`. Run commands from there.

## Agent path — build, then drive

The driver is [`.claude/skills/run-docs/driver.mjs`](./driver.mjs). It serves the
built `./dist` with `astro preview` and asserts the real HTTP surface (HTML,
llms.txt family, a `.md.txt` endpoint, the `.md` copy source, the AI buttons, and
that MDX components actually rendered). Exit 0 = all green.

```bash
bun install            # once, from the repo root or here
bunx astro build       # produces ./dist  (required before the driver)
node .claude/skills/run-docs/driver.mjs --port 4325
```

Expected tail:

```
✓ home renders  (/)
✓ llms.txt  (/llms.txt)
✓ llms-full.txt  (/llms-full.txt)
✓ md.txt endpoint  (/guides/configuration.md.txt)
✓ md copy source  (/guides/configuration.md)
✓ copy-markdown button  (/guides/configuration/)
✓ mdx components render  (/guides/configuration/)
✓ open-in-Claude action  (/guides/configuration/)
✓ open-in-ChatGPT action  (/guides/configuration/)

PASS — docs site serves and all AI endpoints are live.
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

Then `Read` the PNG to confirm it rendered. Reference shots the run-skill author
captured live in this directory: `screenshot-home.png`, `screenshot-page.png`.

## Human path

```bash
bunx astro dev        # http://localhost:4321 with hot reload
```

Useful for editing content; not needed for verification.

## Deploy

```bash
bun run --filter '@statusbeam/docs' deploy    # astro build && wrangler deploy
```

Needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. CI does this via
`.github/workflows/deploy-docs.yml` on merge to `main`.

## Gotchas

- **`.mdx` needs `@astrojs/mdx` — and it's easy to miss.** A page that uses
  `import {...}` + `<Aside>`/`<Steps>`/`<Card>` must be `.mdx` AND
  `@astrojs/mdx` must be installed and added (after `starlight()`) in
  `astro.config.ts`. If it isn't, the build still succeeds but the page renders
  the `import` line as literal text and never expands the components. The
  `mdx components render` driver check exists specifically to catch this — it
  fails if the HTML contains `import {` or lacks `starlight-aside`. Plain `.md`
  files with no components (e.g. `introduction.md`) are fine without any of this.
- **Two Markdown namespaces, on purpose.** `starlight-md-txt` owns `.md.txt`
  (clean agent endpoints); `starlight-page-actions` copies `.md` (source for its
  Copy button). `starlight-md-txt`'s default format is `.md`, which collides with
  that — it's pinned to `format: '.md.txt'` in `astro.config.ts`. Don't remove
  the pin.
- **Only `starlight-llms-txt` emits `llms.txt`.** `starlight-page-actions` would
  also emit one if given a `baseUrl`; it's intentionally configured without one.
- **`agent-browser screenshot <name>` output path varies.** It printed
  `Screenshot saved to page.png` (cwd) in one run and a path under
  `~/.agent-browser/tmp/screenshots/` in another. Grab the path from the command
  output (or `ls -t ~/.agent-browser/tmp/screenshots/*.png | head -1`) instead of
  assuming.

## Troubleshooting

- `✗ ./dist not found` from the driver → run `bunx astro build` first.
- `✗ preview server never came up` → the port is busy; pass a different
  `--port`, or `pkill -f "astro preview"` to clear a stale server.
- Driver hangs / stale content → clear caches: `rm -rf dist .astro` then rebuild.
