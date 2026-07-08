---
name: run-statusbeam-web
description: Run, build, and screenshot the StatusBeam status page (apps/web). Use when asked to start, launch, serve, screenshot, or drive the Astro status page / web app, or to confirm a UI change renders.
---

`apps/web` is `@statusbeam/web` — the StatusBeam **status page**: Astro 7 SSR
(React islands, Tailwind) that renders a services dashboard, 90-day uptime
timelines, and an incident feed, deployed to Cloudflare Workers. It reads its
snapshot from KV but **falls back to built-in SAMPLE data** (`src/lib/data.ts`)
when no Cloudflare binding is present — so `astro dev` renders a full, realistic
page with **no D1/KV, no `wrangler login`, no network**.

Drive it with the committed driver: `.claude/skills/run-statusbeam-web/smoke.sh`.
It starts `astro dev`, asserts the HTTP behavior with `curl`, and screenshots two
locales through the org-standard browser backend. All paths below are relative to
`apps/web/`.

## Prerequisites

Repo toolchain only — no system packages. `bun` + `node` (root `mise.toml` pins
node 24, bun latest) and installed workspace deps (`bun install` at the repo
root; already present in a checked-out repo). `curl` for the HTTP assertions.

For screenshots, a browser backend per `Skill("please:browser-backend")`
(order: **orca** inside an Orca worktree → `chromium-cli` → `agent-browser`).
This skill was authored on the **orca** backend — Orca's embedded browser, which
drives an internal `agent-browser`. Without any backend the driver still runs
every HTTP assertion and just skips the shots.

## Run (agent path) — the smoke driver

From `apps/web/`:

```bash
.claude/skills/run-statusbeam-web/smoke.sh              # start → assert → screenshot → stop
KEEP_SERVER=1 .claude/skills/run-statusbeam-web/smoke.sh   # leave the dev server up
```

Exit 0 = every assertion passed. It covers:

1. **Boot** — launches the `astro dev` daemon and reads its URL from the log
   (Astro auto-bumps the port when 4321 is taken; here it landed on `:4322`).
2. **HTTP asserts (curl)** — bare `/` 302-redirects to `/en/` (locale negotiated
   in `src/middleware.ts`); `/en/` renders the SAMPLE sites (Website/API/CDN) and
   the sample incident; `/api/status.json` returns the degraded-status JSON.
3. **Screenshots** — `/en/` and `/ko/` (proving i18n routing + translated UI
   chrome) via the selected backend, saved to `$OUT` (default `/tmp/sb-web/`).

Expected tail:

```
▸ Screenshotting locales (backend: orca)…
  ✓ screenshot /en/ → /tmp/sb-web/status-en.png
  ✓ screenshot /ko/ → /tmp/sb-web/status-ko.png

▸ Summary: 7 passed, 0 failed. Screenshots in /tmp/sb-web/
```

### Drive it by hand (orca backend — what was verified here)

```bash
bun run dev                                   # daemonizes; prints "Dev server running at http://localhost:4322"
curl -s -o /dev/null -w '%{http_code} %header{location}\n' http://localhost:4322/   # → 302 /en/
orca tab create --url http://localhost:4322/en/ --json    # first time (else: orca goto --url …)
orca wait --text "Website" --json
orca full-screenshot --json > /tmp/en.json    # { result: { data: <base64>, format:"png" } }
node -e 'const r=JSON.parse(require("fs").readFileSync("/tmp/en.json","utf8")).result;require("fs").writeFileSync("/tmp/status-en.png",Buffer.from(r.data,"base64"))'
bunx astro dev stop                            # stop the daemon
```

On a non-Orca machine the driver auto-selects `chromium-cli` or `agent-browser`
(the `agent-browser` plugin is installed). Its branch uses the command shapes
verified from `agent-browser skills get core`:

```bash
agent-browser open   http://localhost:4322/en/
agent-browser wait --text "Website"
agent-browser screenshot /tmp/status-en.png --full
agent-browser close
```

Do not hand-roll headless system Chrome — on macOS it fights the interactive
Chrome and leaves unreaped processes. And do **not** invoke `agent-browser`
directly from inside an Orca session: Orca already owns an internal agent-browser,
so a second one contends and hangs (use the `orca` CLI there — same backend).

## Run (human path)

```bash
bun run dev     # → http://localhost:4322 ; open it in a browser, then: bunx astro dev stop
```

`astro dev` here **daemonizes** (it returns immediately and keeps serving in the
background) — manage it with `bunx astro dev status` / `stop` / `logs`, not Ctrl-C.

## Build / deploy (not run headless here)

`bun run build` (`astro build`) emits a Cloudflare Worker bundle; `bun run
preview` / `deploy` need `wrangler`. The `@astrojs/cloudflare` adapter fuses the
wrangler config at **build** time from `STATUSBEAM_WRANGLER_CONFIG` (see
`astro.config.ts`), which is why the CLI builds per-user — not relevant to a dev
run.

## Test

```bash
bun test    # from the repo root; apps/web currently has no package-local test files
```

## Gotchas

- **No Cloudflare needed in dev.** Every `getSummary`/`getIncidents`/`getLocale`
  in `src/lib/data.ts` returns SAMPLE data when `env.STATUS_KV` is unbound, so the
  page is fully populated (3 services, 2 incidents, 90-day timelines) offline.
  The sample status is deliberately **degraded** (API at 2310 ms) — that's why
  the banner reads "Degraded Performance", not a bug.
- **`astro dev` is a daemon, not a foreground process.** `bun run dev` returns
  and the server keeps running. The driver reads the URL from `dev.log` and stops
  the daemon on exit; if you start it by hand, `bunx astro dev stop` to clean up.
- **Port isn't fixed.** Astro uses 4321 by default but auto-bumps (it was `:4322`
  here). Read the printed URL — don't hardcode.
- **Inside Orca, use `orca`, not raw `agent-browser`.** Orca owns an internal
  agent-browser session; invoking `agent-browser open …` directly from an Orca
  terminal hangs on that contention. The backend selector keys off
  `TERM_PROGRAM=Orca` / `ORCA_WORKTREE_ID` to route through the `orca` CLI.
- **Orca screenshots come back as base64 JSON**, not a file — `orca
  full-screenshot --json` returns `{ result: { data, format } }`; decode it (the
  driver pipes it through a one-line `node` Buffer write).
- **`orca full-screenshot` with no open tab errors `browser_no_tab`.** Open one
  with `orca tab create --url …` first; thereafter `orca goto --url …` reuses it.

## Troubleshooting

- **`✗ dev server never came up`** — check `/tmp/sb-web/dev.log`; usually a stale
  daemon on the port. `bunx astro dev stop` and re-run (the driver does this
  automatically at start).
- **Screenshots skipped, `backend: none`** — no browser backend on PATH. Inside
  Orca ensure `orca` resolves; otherwise `npm i -g agent-browser && agent-browser
  install`.
- **`browser_no_tab` / `browser_stale_ref` from orca** — the tab was closed or
  navigated; the driver's `tab create`-then-`goto` fallback handles it, but by
  hand re-run `orca tab create --url …`.
