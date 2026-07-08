---
name: run-statusbeam-worker
description: Run, build, and drive the StatusBeam check Worker (apps/worker). Use when asked to start, launch, serve, smoke-test, or curl the Cloudflare Worker — the cron probe and the Statuspage webhook endpoint — or to confirm a webhook/ingest change works.
---

`apps/worker` is `@statusbeam/worker` — the StatusBeam **check Worker**: a
Cloudflare Worker with two entrypoints (`src/index.ts`):

- **`fetch`** — inbound Atlassian Statuspage subscriber webhooks at
  `POST /webhooks/statuspage/:slug` (`src/webhook.ts`), authenticated by a
  `?token=` shared secret, that ingest a single site's status in real time.
- **`scheduled`** (cron) — probes every configured site and ingests the batch.

Both feed the same pipeline (`src/ingest.ts`): write a row to D1 `checks`,
rewrite the KV `summary` the status page reads, and (on a status change) notify +
purge cache. It's a server, so it's driven with **`wrangler dev` (local
miniflare) + `curl`** — no real Cloudflare account, no `wrangler login`. Drive it
with the committed driver: `.claude/skills/run-statusbeam-worker/smoke.sh`.

All paths below are relative to `apps/worker/`.

## Prerequisites

Repo toolchain only — `bun` + `node` (root `mise.toml`) and installed workspace
deps. `wrangler` ships with this package (`bunx wrangler`, v4). `curl` for the
HTTP assertions. No system packages.

The Worker imports `@statusbeam/core` from its **built** `dist/` — that build is
the one non-obvious prerequisite (see Build).

## Build

```bash
bun run --filter '@statusbeam/core' build   # from the repo root — REQUIRED first
```

Without it `wrangler dev` fails with `The module "./dist/index.js" was not found`
— the Worker resolves `@statusbeam/core` to its compiled output, not its source.
The Worker itself isn't pre-bundled; `wrangler dev` bundles `src/index.ts` on the
fly.

## Run (agent path) — the smoke driver

From `apps/worker/`:

```bash
.claude/skills/run-statusbeam-worker/smoke.sh              # build → seed → serve → drive → stop
PORT=8901 .claude/skills/run-statusbeam-worker/smoke.sh    # override the dev port
KEEP_SERVER=1 .claude/skills/run-statusbeam-worker/smoke.sh  # leave wrangler dev running
```

Exit 0 = every assertion passed. It builds core, seeds local D1 + KV, launches
`wrangler dev` in local mode, then drives:

1. **The webhook status-code matrix** (`fetch`): `404` non-webhook path, `405`
   GET, `401` no/wrong token (secret fails closed), `404` unknown / non-statuspage
   slug, `400` malformed / wrong-shaped JSON, `204` event for another component,
   `200` matching event.
2. **Ingest side effects** of the `200`: the KV `summary` shows `claude-api →
   down` and D1 has the mapped check row.
3. **The cron handler** via `/cdn-cgi/handler/scheduled` → `200` (runs real HTTP
   checks of the seeded sites).
4. **Direct invocation** of the pure helpers (`parseWebhookPath`,
   `timingSafeEqual`).
5. **The unit test suite** (`bun test`, 19 tests).

Expected tail:

```
▸ Summary: 15 passed, 0 failed.
```

### Drive it by hand

Set up local state and launch (the driver's port default is 8799; wrangler's own
default is 8787):

```bash
bun run --filter '@statusbeam/core' build            # from repo root
bunx wrangler d1 execute statusbeam --local --file=./schema.sql
bunx wrangler kv key put config --binding=STATUS_KV --local --path=/tmp/sb-worker/config.yml
bunx wrangler dev --port 8799 --var WEBHOOK_SECRET:s3cret &   # wait for "Ready on http://localhost:8799"
```

`/tmp/sb-worker/config.yml` must list a `check: statuspage` site — the driver
seeds one (slug `claude-api`, component `Claude API (api.anthropic.com)`), mirroring
`src/webhook.handler.test.ts`. Then curl (quote the URL — zsh globs `?`):

```bash
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8799/nope"                       # 404
curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://localhost:8799/webhooks/statuspage/claude-api"  # 401 (no token)
# 200 ingest: a component_update mapping the configured component to major_outage
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "http://localhost:8799/webhooks/statuspage/claude-api?token=s3cret" \
  -H 'content-type: application/json' --data-binary @/tmp/sb-worker/major.json
bunx wrangler kv key get summary --binding=STATUS_KV --local     # → claude-api "status":"down"
bunx wrangler d1 execute statusbeam --local --command "SELECT slug,status FROM checks ORDER BY id DESC LIMIT 2"
curl -s "http://localhost:8799/cdn-cgi/handler/scheduled"        # trigger cron
```

### Direct invocation

The pure routing/auth helpers many PRs touch, without a running Worker:

```bash
NODE_ENV=test bun -e 'import("./src/webhook.ts").then(m => console.log(m.parseWebhookPath("/webhooks/statuspage/claude-api"), m.timingSafeEqual("a","a")))'
# → { slug: "claude-api" } true
```

## Run (human path)

```bash
bunx wrangler dev    # serves on http://localhost:8787 ; Ctrl-C to stop
```

Useful for interactive curling, but on its own it has **no config in KV and no D1
schema**, so any webhook past the auth gate 500s/404s and `scheduled` throws
`No config in KV`. Seed local state first (see above).

## Test

```bash
bun test    # 19 pass, 0 fail — from apps/worker/
```

## Gotchas

- **Build `@statusbeam/core` first** or `wrangler dev` won't start (`./dist/index.js`
  not found). The Worker imports the package's compiled output, not its `src`.
- **Cron isn't auto-triggered in local dev.** `wrangler dev` prints "Scheduled
  Workers are not automatically triggered during local development" — hit
  `curl http://localhost:<port>/cdn-cgi/handler/scheduled` to fire it manually.
- **`WEBHOOK_SECRET` fails closed.** With it unset, *every* webhook POST → 401,
  even a correct-looking one. Pass it with `wrangler dev --var WEBHOOK_SECRET:…`
  (or a `.dev.vars` file, gitignored) to exercise anything past auth.
- **The 200 path needs three things aligned:** the secret set, the KV `config`
  seeded with a `check: statuspage` site, and the payload's `component.name`
  matching that site's `component:`. Otherwise you get 401 / 404 / 204 instead —
  each is a *correct* response, not a failure.
- **zsh globs `?token=`.** Quote every webhook URL or the shell errors with "no
  matches found" before curl even runs.
- **Local state persists in `.wrangler/` (gitignored).** D1 rows accumulate
  across driver runs; the schema (`CREATE … IF NOT EXISTS`) and KV seed are
  idempotent, so re-runs stay green.
- **Not a browser/GUI surface** — there's nothing to screenshot; the status
  codes + KV/D1 side effects are the observable behavior.

## Troubleshooting

- **`The module "./dist/index.js" was not found`** — run the core build (Build
  section).
- **`✗ wrangler dev never became ready`** — check `/tmp/sb-worker/dev.log`;
  usually a port already in use (pass a different `PORT=…`) or a core build that
  didn't run.
- **Webhook 401 when you expect 200** — `WEBHOOK_SECRET` unset or token mismatch.
- **Webhook 404 "Unknown site" / cron `No config in KV`** — the KV `config` key
  isn't seeded into the same local state; re-run the `wrangler kv key put … --local`
  step from `apps/worker/`.
