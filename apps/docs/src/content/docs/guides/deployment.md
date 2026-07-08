---
title: Deploy to Cloudflare
description: Provision D1 + KV, wire the resource IDs, and deploy the Worker and status page to Cloudflare.
---

import { Steps, Aside } from '@astrojs/starlight/components';

StatusBeam runs entirely on Cloudflare: a Cron Worker for checks and an Astro
site for the page, backed by D1 (time-series) and KV (current snapshot). The repo
ships a scripted path and a manual one — the outline below mirrors the repo's
`DEPLOYMENT.md`, which is the authoritative reference.

<Aside type="tip">
  Fastest path: `bun run setup` runs the scripted provisioning. The steps below
  are the manual equivalent.
</Aside>

## Steps

<Steps>

1. **Provision D1 + KV.** Create the D1 database and KV namespace in your
   Cloudflare account.

2. **Wire the resource IDs** into each app's `wrangler.jsonc` (the `database_id`
   and KV `id` placeholders).

3. **Write your config** — see [Configuration](/guides/configuration/).

4. **Apply the D1 schema** to create the time-series and incident tables.

5. **Upload the config to KV** under the `config` key.

6. **Set secrets** for optional integrations (Slack/webhook URLs live inside the
   KV `config`, cache-purge credentials as Worker secrets).

7. **Deploy.**

   ```bash
   bun run deploy
   ```

   This deploys the check Worker and the web app to Cloudflare.

8. **Verify** the first cron run has populated D1/KV and the page renders.

</Steps>

## Deploying these docs

This documentation site is a separate app (`apps/docs`). It is a fully static
Starlight build served from Cloudflare via **Workers Static Assets** — no D1/KV,
no server adapter:

```bash
bun run --filter '@statusbeam/docs' deploy
```

<Aside type="note">
  See the repo's `DEPLOYMENT.md` for the full, authoritative deployment guide,
  including troubleshooting and the exact `wrangler` commands.
</Aside>
