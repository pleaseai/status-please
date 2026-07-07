# status-please

[![CI](https://github.com/pleaseai/status-please/actions/workflows/ci.yml/badge.svg)](https://github.com/pleaseai/status-please/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_status-please&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=pleaseai_status-please)
[![codecov](https://codecov.io/gh/pleaseai/status-please/graph/badge.svg)](https://codecov.io/gh/pleaseai/status-please)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> An open-source, CDN-native **status page** generator — the modern successor to [upptime](https://github.com/upptime/upptime).

`status-please` monitors your services, records their uptime as durable time-series
data, and publishes a fast, good-looking status page to the edge. It keeps the parts
of upptime that people love — config-as-YAML, zero servers to babysit, badges, a
public JSON API — while fixing upptime's biggest structural weaknesses:

- **No client-side rate limits.** upptime's page calls the GitHub API *from the
  visitor's browser* (unauthenticated, 60 req/h/IP), so popular pages break with a
  "rate limit exceeded" screen. `status-please` renders every byte at the edge from
  its own store — the browser never talks to a third-party API.
- **Reliable scheduling.** upptime rides GitHub Actions cron, which is best-effort
  (a "every 5 min" job can slip to 15–60 min). `status-please` uses **Cloudflare
  Cron Triggers**, which fire on time.
- **A store that scales.** upptime treats git commit history as its database and
  walks it through a rate-limited API. `status-please` uses **Cloudflare D1 + KV**,
  purpose-built for time-series reads.
- **A current, maintained frontend.** upptime's page is built on **Svelte 3 + Sapper**,
  both end-of-life. `status-please` is **Astro + shadcn/ui**.

---

## Status

🚧 **Early development.** This repository currently defines the architecture and the
tech-stack decision. Code is being built out — see the [Roadmap](#roadmap).

---

## How it works

`status-please` is deliberately split into three independent layers. Each can be
understood, deployed, and replaced on its own.

```
        ┌──────────────────────────────────────────────────────────────┐
        │  1. CHECK LAYER — Cloudflare Cron Worker                       │
        │     • Cron Triggers ping every configured service on schedule  │
        │     • Derives up / degraded / down from status + response time │
        │     • Writes time-series to D1, current snapshot to KV         │
        │     • On a status change: enqueue a notification event, and    │
        │       purge the page/badge cache by tag (ctx.cache.purge)      │
        └──────────┬────────────────┬─────────────────────┬────────────-┘
                   │ writes         │ enqueues            │ purges on change
                   ▼                ▼                     │
        ┌───────────────────┐  ┌──────────────────────┐   │
        │ D1 (time-series,  │  │ 2. NOTIFY LAYER —    │   │
        │     incidents)    │  │    Queue consumer    │   │
        │ KV (current       │  │  • Email, Slack,     │   │
        │     snapshot)     │  │    webhook, RSS/Atom │   │
        └─────────┬─────────┘  └──────────────────────┘   │
                  │ reads at the edge                      │
                  ▼                                        ▼
        ┌──────────────────────────────────────────────────────────────┐
        │  3. DISPLAY LAYER — Astro site on Cloudflare                   │
        │     • Renders the page at the edge from D1/KV (no browser →    │
        │       third-party API calls, so no client rate limits)         │
        │     • Fronted by Workers Cache (tiered edge cache): renders    │
        │       set Cache-Control + stale-while-revalidate, hits skip    │
        │       the Worker + D1, concurrent requests collapse; the check │
        │       layer purges by tag on change, so updates are near-      │
        │       instant, not TTL-bound                                   │
        │     • shadcn/ui via React islands for the interactive bits     │
        │       (charts, time-range filters); everything else ships 0 JS │
        │     • Emits shields.io-compatible badge JSON + a public API    │
        └──────────────────────────────────────────────────────────────┘
```

Because the check and display layers live on Cloudflare — **not** on the
infrastructure being monitored — your status page stays up even when your own
services are down. That resilience is the whole point of a status page.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| **Frontend** | [Astro 7](https://astro.build/blog/astro-7/) | Static-first (ideal for a mostly-read page), ~0 KB JS by default, a Cloudflare first-party framework (acquired Jan 2026) with `workerd` dev/prod parity, a Rust compiler (15–61% faster builds), and a stable **`Astro.cache` route-caching API** plus an experimental `cacheCloudflare()` provider for [Workers Cache](https://blog.cloudflare.com/workers-cache/). |
| **UI components** | [shadcn/ui](https://ui.shadcn.com) (React islands) + Tailwind CSS | Copy-in-your-repo components you own and can fork — perfect for OSS. Used natively via Astro's React islands; hydrated only where interactivity is needed. |
| **Charts** | shadcn/ui charts (Recharts) | Response-time graphs, themed and dark-mode-ready out of the box. |
| **Check scheduler** | Cloudflare **Cron Triggers** (Worker) | On-time execution, unlike GitHub Actions cron. |
| **Data store** | Cloudflare **D1** (SQLite) + **KV** | D1 for time-series & incident history; KV for the current snapshot. |
| **Edge cache** | Cloudflare **[Workers Cache](https://blog.cloudflare.com/workers-cache/)** | Tiered cache in front of the Astro Worker: `Cache-Control` + `stale-while-revalidate`, request collapsing, and **tag-based purge on status change** — near-instant updates without hammering D1. Today via `Cache-Control` headers; Astro 7's `Astro.cache` / `cacheCloudflare()` is the forward path. |
| **Notifications** | Cloudflare Workers + Queues | Email / Slack / webhook / RSS on status change, decoupled from the UI. |
| **Deploy target** | **Cloudflare** (primary) · Vercel (supported) | Astro adapters target both; Cloudflare is the native, batteries-included path. |
| **Tooling** | Bun · Wrangler · TypeScript | Bun for install/scripts; Wrangler for Worker + D1 + KV. |

The full rationale — including why Astro over SvelteKit and TanStack Start, and why
a Cron Worker over GitHub Actions — is in
[`docs/adr/0001-tech-stack.md`](docs/adr/0001-tech-stack.md).

---

## Design

The UI follows the information architecture proven by
[Statuspage.io](https://www.atlassian.com/software/statuspage) and the modern,
static-first aesthetic of [Instatus](https://instatus.com):

- **Overall-status banner** — one calm, unambiguous line ("All Systems Operational")
  in a single color that rolls up the worst component state.
- **Component rows** — one per service, grouped and collapsible, each with a status
  pill: Operational / Degraded / Partial Outage / Major Outage / Maintenance.
- **90-day uptime bars** — the signature timeline: one colored bar per day, hover for
  date + uptime % + linked incidents, gray for no-data days. Adaptive intervals
  (Instatus-style) let the same component render other windows.
- **Incident timeline** — a reverse-chronological, date-grouped feed; each incident
  threads timestamped updates through the
  Investigating → Identified → Monitoring → Resolved lifecycle. Scheduled maintenance
  is a distinct, forward-looking entry.
- **One severity token system** — five states as CSS variables (light + dark, OKLCH),
  driving the banner, pills, and bars from a single source of truth. Dark mode ships
  by default. Color is paired with icon + text for accessibility.

---

## Project layout

A Bun-workspaces monorepo. The three runtime layers map to three workspaces, with
the domain logic shared in `core`:

```
status-please/
├── apps/
│   ├── web/       # Astro status page (Cloudflare adapter + Workers Cache)
│   └── worker/    # Cron Worker: checks + notifications (D1/KV, schema.sql)
├── packages/
│   └── core/      # shared config schema (zod), types, status derivation
├── status.config.example.yml
├── mise.toml      # pinned toolchain (node, bun)
└── orca.yaml      # worktree setup
```

Local development:

```bash
mise install        # pinned node + bun
bun install         # install workspaces
bun run test        # core unit tests (bun:test)
bun run dev         # Astro dev server (renders sample data without bindings)
```

## Configuration

A single YAML file is the only thing you edit — the same idea as upptime's
`.upptimerc.yml`. Copy [`status.config.example.yml`](./status.config.example.yml) to
`status.config.yml`:

```yaml
# status.config.yml
name: Acme Status
sites:
  - name: Website
    url: https://example.com
    check: http # http | tcp | ssl
    expectedStatusCodes: [200]
    maxResponseTime: 2000 # ms → "degraded" above this
  - name: API
    url: https://api.example.com/health
    check: http
notifications: # all optional; keep the real Slack URL (a secret) in your KV config
  slack:
    webhookUrl: https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX
  webhooks:
    - url: https://example.com/status-hook
theme:
  logoUrl: /logo.svg
  darkMode: true
```

---

## Deployment

`status-please` deploys to any Cloudflare account (Workers + D1 + KV + Pages). Vercel
is also supported for the display layer via Astro's Vercel adapter.

```bash
# 1. Use this template / clone it
# 2. Provision Cloudflare resources
bunx wrangler d1 create status-please
bunx wrangler kv namespace create STATUS_KV

# 3. Configure your services in status.config.yml, then deploy
bun install
bun run deploy
```

### Instant cache invalidation (optional)

By default the page is edge-cached for `s-maxage=60`, so a status change shows up
within a minute. For **near-instant** updates, the check Worker purges the edge
cache by [Cache-Tag](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/)
the moment a status flips. The page already emits a matching `Cache-Tag` response
header (`status-page` + one `status-site-<slug>` per component); you just provide
the Worker two secrets (purge-by-tag is [available on all Cloudflare plans](https://developers.cloudflare.com/changelog/post/2025-04-01-purge-for-all/) since April 2025):

```bash
bunx wrangler secret put CF_API_TOKEN   # API token with the "Cache Purge" permission
bunx wrangler secret put CF_ZONE_ID     # the zone serving your status page
```

When these are unset the purge is skipped (logged, not fatal) and the page simply
refreshes on its 60s TTL.

Detailed setup will land with the first release — see the [Roadmap](#roadmap).

---

## Roadmap

- [ ] **Check layer** — Cron Worker: HTTP/TCP/SSL checks, D1 schema, KV snapshot.
- [ ] **Display layer** — Astro site, shadcn/ui component set, severity token system.
- [ ] **Uptime bars & charts** — 90-day adaptive timeline, response-time graphs.
- [ ] **Incidents** — lifecycle model + timeline UI + scheduled maintenance.
- [ ] **Badges & public API** — shields.io-compatible JSON endpoints.
- [ ] **Notify layer** — Slack + webhook, then email + RSS/Atom.
- [ ] **Migration guide** — importing an existing `.upptimerc.yml`.
- [ ] **Vercel adapter path** — documented alternative to Cloudflare.

---

## Prior art & inspiration

- [upptime/upptime](https://github.com/upptime/upptime) — the serverless-monitoring
  idea this project builds on.
- [Statuspage.io](https://www.atlassian.com/software/statuspage) — the reference
  information architecture.
- [Instatus](https://instatus.com) — static-first delivery and modern design.
- [statping/statping](https://github.com/statping/statping) — a self-hosted,
  single-binary status server (Go) with its own monitoring engine, notifiers,
  and mobile app.
- [OpenStatus](https://www.openstatus.dev) — open-source synthetic monitoring and
  status pages, with a globally distributed checker for latency-aware probing.
- [CachetHQ/Cachet](https://cachethq.io) — a long-standing open-source status page
  system (PHP/Laravel) centered on incident and component management.

---

## License

MIT
