# Deployment

`status-please` runs entirely on Cloudflare: a **check Worker** (`apps/worker`) probes
your services on a cron and writes results to **D1** (history) and **KV** (the current
snapshot + config); a **status page** (`apps/web`, Astro SSR on Workers) renders that
snapshot at the edge, fronted by Workers Cache.

This guide takes you from an empty Cloudflare account to a live status page, then wires
the manual GitHub Actions deploy for repeat deploys.

## Prerequisites

- A Cloudflare account (any plan — [cache purge-by-tag is available on all plans](https://developers.cloudflare.com/changelog/post/2025-04-01-purge-for-all/) since April 2025).
- [mise](https://mise.jdx.dev) + [bun](https://bun.sh): `mise trust && mise install && bun install`.
- Wrangler auth for local commands: `bunx wrangler login` (or export `CLOUDFLARE_API_TOKEN`).

## 1. Provision D1 + KV

```bash
bunx wrangler d1 create status-please
bunx wrangler kv namespace create STATUS_KV
```

Each command prints an ID. You need two: the **D1 `database_id`** and the **KV namespace `id`**.
The same D1 and KV are shared by the worker and the web app.

## 2. Wire the resource IDs

Both `apps/worker/wrangler.jsonc` and `apps/web/wrangler.jsonc` ship with placeholders
(`REPLACE_WITH_D1_DATABASE_ID`, `REPLACE_WITH_KV_NAMESPACE_ID`). For a self-hosted fork,
just replace them with your real IDs and commit — resource IDs are not secret. (The CI
deploy in §7 injects them from repo Variables instead, so you can leave the placeholders
in place if you deploy only through Actions.)

## 3. Write your config

```bash
cp status.config.example.yml status.config.yml
$EDITOR status.config.yml   # list your services; see the example for every field
```

`status.config.yml` is your service list, not a secret — commit it to your fork so the
deploy can upload it. Keep real webhook URLs out of it (see §6).

## 4. Apply the D1 schema

```bash
bunx wrangler d1 execute status-please --remote --file=./apps/worker/schema.sql --yes
```

The schema uses `CREATE TABLE IF NOT EXISTS`, so re-running it is safe.

## 5. Upload the config to KV

```bash
bunx wrangler kv key put config --binding=STATUS_KV --path=status.config.yml --remote \
  --config apps/worker/wrangler.jsonc
```

The worker reads `config` from KV on each run; the page falls back to bundled sample data
until the first cron populates the `summary` key.

## 6. Set secrets (optional integrations)

Secrets are set on the **check Worker** and never committed.

```bash
# Outbound notifications — Slack/webhook URLs live in the KV `config`, not here,
# but keep the config's webhook URLs private (don't commit real ones).

# Instant cache invalidation (see README "Instant cache invalidation"):
bunx wrangler secret put CF_API_TOKEN --config apps/worker/wrangler.jsonc   # "Cache Purge" permission
bunx wrangler secret put CF_ZONE_ID   --config apps/worker/wrangler.jsonc   # zone serving the page
```

When the two cache secrets are unset, a status change still shows up within the 60s edge
TTL — the purge is skipped, logged, not fatal.

## 7. Deploy

**Locally**, once the IDs are wired (§2):

```bash
bun run deploy   # builds + deploys the worker, then the web app
```

**Via GitHub Actions** (`.github/workflows/deploy.yml`, `workflow_dispatch` — manual):
the workflow injects resource IDs, applies the D1 schema, uploads the config, and deploys
both. Configure once:

```bash
# Secrets (sensitive):
gh secret set CLOUDFLARE_API_TOKEN     # token with Workers/D1/KV edit + Cache Purge
gh secret set CLOUDFLARE_ACCOUNT_ID

# Variables (resource IDs — not sensitive):
gh variable set CF_D1_DATABASE_ID
gh variable set CF_KV_NAMESPACE_ID
```

Then run it from the **Actions** tab (or `gh workflow run deploy.yml`). The job uses a
`production` GitHub Environment, so you can add required-reviewer protection in repo
settings to gate every deploy behind an approval.

## 8. After the first deploy

- The cron runs every 5 minutes (`triggers.crons` in `apps/worker/wrangler.jsonc`); the
  page shows sample data until the first run writes the real `summary` — just wait for the
  first tick. (To force a run against production immediately, invoke the deployed Worker's
  scheduled handler from the Cloudflare dashboard's Cron Triggers → "Trigger" action.)
- Point a custom domain at the `status-please-web` Worker via a route in its
  `wrangler.jsonc` or the Cloudflare dashboard.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Page shows sample services | KV `summary` not written yet — wait for the cron, or check the worker's logs (`bunx wrangler tail`). |
| Deploy workflow fails on preflight | A required secret/variable is unset — the error names which. See §7. |
| Status changes take ~60s | Cache purge secrets unset (§6) — expected; set `CF_API_TOKEN`/`CF_ZONE_ID` for instant purge. |
| `d1 execute` prompts in CI | Non-interactive runs auto-confirm; the workflow passes `--yes`. |
