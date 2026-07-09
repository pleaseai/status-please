# Deployment

StatusBeam runs entirely on Cloudflare: a **check Worker** probes your services on a
cron and writes results to **D1** (history) and **KV** (the current snapshot + config);
a **status page** (Astro SSR on Workers) renders that snapshot at the edge, fronted by
Workers Cache.

You deploy it as a **package**, not a fork ([ADR-0002](docs/adr/0002-package-based-distribution.md)):
your repo holds only your config, and the app itself is a versioned dependency. Upgrading
is `statusbeam update`, not an upstream merge.

## Quick start

### 1. Scaffold your project

Either way you get the same thin project — `status.config.yml`, two `wrangler.*.jsonc`
configs, and a `deploy.yml` that runs the CLI:

- **Terminal:** `bunx create-statusbeam my-status`
- **GitHub:** open the [`statusbeam-template`](https://github.com/pleaseai/statusbeam-template)
  repo and click **"Use this template"** (a clean repo, *not* a fork — so there's no
  conflict-prone upstream merge; updates come through the package).

### 2. Provision + deploy

```bash
cd my-status
mise trust && mise install && bun install
bunx wrangler login            # or export CLOUDFLARE_API_TOKEN
bunx statusbeam setup          # provisions, prompts, configures, deploys
```

`statusbeam setup` runs everything for you, idempotently: it provisions D1 + KV, asks a
couple of wrangler questions (custom domain, cron schedule), writes the resource IDs and
your answers into both `wrangler.*.jsonc` files, applies the D1 schema, uploads
`status.config.yml` to KV, and deploys both Workers. Flags: `--skip-deploy` (provision +
configure only) and `--yes` (non-interactive, accept every default). **Commit the updated
`wrangler.worker.jsonc` and `wrangler.web.jsonc`** afterwards — the resource IDs are not
secret, and CI needs them.

The page shows bundled sample data until the first cron writes a real snapshot — just wait
for the first tick (or trigger the Worker's scheduled handler from the Cloudflare dashboard
→ Cron Triggers → "Trigger").

## The CLI

| Command | What it does |
| --- | --- |
| `statusbeam setup` | Provision D1 + KV, wire IDs/domain/cron into your wrangler configs, apply schema, upload config, deploy. Idempotent — re-run to change the domain/cron or redeploy. |
| `statusbeam deploy` | Apply the schema, upload `status.config.yml` to KV, deploy the check Worker, then build + deploy the status page. |
| `statusbeam update` | Bump `@statusbeam/*` via your package manager. Follow with `statusbeam deploy`. |

Day to day: edit `status.config.yml` (your service list — see the comments in the file for
every field), then `bunx statusbeam deploy`.

## Deploy from CI

The scaffolded `.github/workflows/deploy.yml` runs `statusbeam deploy` on every push to
`main`. Configure the two Cloudflare secrets once:

```bash
gh secret set CLOUDFLARE_API_TOKEN     # see token requirements below
gh secret set CLOUDFLARE_ACCOUNT_ID
```

The resource IDs live in your committed `wrangler.*.jsonc` (written by `statusbeam setup`),
so CI needs only the credentials. The job uses a `production` GitHub Environment — add
required-reviewer protection in repo settings to gate every deploy behind an approval.

> **Use a User API token, not an account-owned token.** Create it under **My Profile → API
> Tokens** (the "Edit Cloudflare Workers" template covers Workers Scripts / D1 / KV Edit).
> An *account-owned* token fails the D1 schema step with `Authentication error [code:
> 10000]` — `wrangler d1 execute --remote` needs `User → Memberships → Read`, a User-scoped
> permission account-owned tokens cannot hold. Add **Cache Purge** for instant invalidation,
> and if you serve a **custom domain** also add **Zone → Workers Routes: Edit** and **Zone →
> DNS: Edit** for that zone.

## Custom domain

`statusbeam setup` writes the custom-domain route into `wrangler.web.jsonc` from your
answer. If the zone lives in the same Cloudflare account, Cloudflare auto-provisions the
proxied DNS record and edge cert (issuance takes a few minutes). Re-run `statusbeam setup`
to change or remove it. Caveats: (1) a custom domain still keeps the `*.workers.dev` URL as
a fallback (`workers_dev: true`); (2) the deploy token needs **Zone → Workers Routes: Edit**
and **Zone → DNS: Edit** for that zone, otherwise the deploy fails on
`/zones/.../workers/routes` with `code: 10000`.

## Private / internal pages (Cloudflare Access)

To restrict a status page to employees or a specific audience, gate it at the **edge**
with [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
(Zero Trust) rather than adding a login to the app. Access sits **ahead of** the Worker and
the edge cache, so it needs **no code change** and never serves private content from cache
to an unauthenticated visitor ([ADR-0003](docs/adr/0003-private-pages-via-cloudflare-access.md)).

**Prerequisite:** a [custom domain](#custom-domain) on a Cloudflare zone in your account.
Access cannot protect a bare `*.workers.dev` URL, so a private page must close that unguarded
fallback by setting `workers_dev: false` in `wrangler.web.jsonc`. Note that `statusbeam setup`
**manages the networking block** (between its generated markers) and writes `workers_dev: true`
there — so change it to `false` inside that block, and re-apply after any `setup` re-run (e.g.
to change the domain), which rewrites the block back to `true`.

### Gate the whole page

1. Cloudflare dashboard → **Zero Trust → Access → Applications → Add an application →
   Self-hosted**.
2. Set the application domain to your status page hostname (e.g. `status.internal.example.com`).
3. Add a policy — **Action: Allow**, e.g. *Emails ending in* `@yourco.com`, or an IdP group
   (Google, Okta, GitHub, Entra, …) / a one-time PIN. Save.

Everything on the hostname — pages, badges, feeds, and JSON — now requires sign-in.

### Keep badges / feeds / JSON public on a private page (optional)

A blanket gate also blocks the cookie-less machine endpoints — badges
(`/api/badge/…`, embedded in READMEs), feeds (`/feed.rss`, `/feed.atom`, `/history.*`), and
JSON (`/api/status.json`). If you want those to stay reachable while the page itself is
gated, choose per consumer:

- **Public machine endpoints:** add a *second, more-specific* Access application with a
  **Bypass** policy (*Everyone*) for each public path — a more-specific path application takes
  precedence over the hostname one. Badges and JSON both live under `/api`, so one bypass app
  on `status.internal.example.com/api` covers them; the **feeds do not** — `/feed.rss`,
  `/feed.atom`, `/history.rss`, and `/history.atom` sit at the root, so add a bypass app for
  each (or they stay gated).
- **Trusted CI / monitors:** issue an Access **service token** and send its
  `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers, instead of opening the path.

### Public page + separate internal page

Access is all-or-nothing per hostname — it can't show some services publicly and others only
to staff on one page. To run both, **deploy a second copy** rather than adding visibility
rules to the app:

1. Copy `wrangler.web.jsonc` to `wrangler.internal.jsonc`; give it a different Worker `name`
   and an internal `routes` hostname (its own D1/KV, or the same bindings with a separate
   `status.config.yml` if the service lists differ).
2. Deploy it alongside the public one:
   `bunx wrangler deploy --config wrangler.internal.jsonc`.
3. Put an Access application (above) on the internal hostname only; leave the public
   hostname open.

## Optional: instant cache invalidation

On a status change the check Worker purges the edge cache by tag, so updates are
near-instant instead of waiting the 60s edge TTL. Set two secrets on the **check Worker**:

```bash
bunx wrangler secret put CF_API_TOKEN --config wrangler.worker.jsonc   # "Cache Purge" permission
bunx wrangler secret put CF_ZONE_ID   --config wrangler.worker.jsonc   # zone serving the page
```

When unset, a status change still shows up within the 60s edge TTL — the purge is skipped,
logged, not fatal.

## Upgrading

```bash
bunx statusbeam update      # pulls new @statusbeam/* releases
bunx statusbeam deploy      # ship them
```

Because your repo never vendored the app source, there's no upstream merge — automate it
with Renovate or Dependabot on your repo if you like.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Page shows sample services | KV `summary` not written yet — wait for the cron, or check the worker's logs (`bunx wrangler tail --config wrangler.worker.jsonc`). |
| `statusbeam setup` says "not authenticated" | Run `bunx wrangler login` (or set `CLOUDFLARE_API_TOKEN`) and re-run. |
| Deploy CI fails on preflight | `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` unset — the error names which. |
| Status changes take ~60s | Cache-purge secrets unset — expected; set `CF_API_TOKEN`/`CF_ZONE_ID` for instant purge. |
| `d1 execute` prompts in CI | Non-interactive runs auto-confirm; the CLI passes `--yes`. |

---

## Appendix: self-host from source (fork the monorepo)

The package flow above is the recommended default. If you want to modify the app source
itself, you can still clone and deploy the monorepo directly:

```bash
git clone https://github.com/pleaseai/statusbeam && cd statusbeam
mise trust && mise install && bun install
bunx wrangler login
bun run setup                # scripts/setup.sh — provisions + configures + deploys the monorepo
```

This edits the monorepo's own `apps/worker/wrangler.jsonc` + `apps/web/wrangler.jsonc` and
`status.config.yml` in place, then `bun run deploy` builds and deploys both Workers. It's
the same D1/KV/schema/config/deploy steps the CLI performs, run against the monorepo layout.
You own upstream merges on this path — which is exactly the tax the package flow removes.
