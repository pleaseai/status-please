# StatusBeam status page

Your own [StatusBeam](https://github.com/pleaseai/statusbeam) status page, deployed
to Cloudflare. This repo holds only *your* config — the app itself is a versioned
dependency (`@statusbeam/cli` + the worker/web packages), so upgrading is a
`statusbeam update`, not a fork-merge.

## What's here

| File | Yours to edit |
|---|---|
| `status.config.yml` | **Yes** — your service list, page name, theme, notifications |
| `wrangler.worker.jsonc` | The check Worker's Cloudflare config (ids/cron; `statusbeam setup` fills ids) |
| `wrangler.web.jsonc` | The status page's Cloudflare config (ids/domain/cache) |
| `.github/workflows/deploy.yml` | CI that runs `statusbeam deploy` on push |

## First deploy

```bash
mise trust && mise install && bun install
bunx wrangler login          # or export CLOUDFLARE_API_TOKEN
bunx statusbeam setup        # provisions D1 + KV, wires ids, deploys
```

Commit the updated `wrangler.*.jsonc` (with your real resource ids) afterwards.

## Ongoing

- **Change services:** edit `status.config.yml`, then `bunx statusbeam deploy`.
- **Deploy from CI:** push to `main` (set `CLOUDFLARE_API_TOKEN` +
  `CLOUDFLARE_ACCOUNT_ID` as repo secrets first).
- **Upgrade StatusBeam:** `bunx statusbeam update`, then `bunx statusbeam deploy`.

The page shows sample data until the first cron writes a real snapshot.
