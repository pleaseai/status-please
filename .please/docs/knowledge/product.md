# Product Guide — StatusBeam

## Vision

StatusBeam is an open-source, CDN-native **status page generator** — the modern
successor to [upptime](https://github.com/upptime/upptime). It monitors services,
records their uptime as durable time-series data, and publishes a fast,
good-looking status page rendered entirely at the edge.

It keeps what people loved about upptime — config-as-YAML, zero servers to
babysit, badges, a public JSON API — while fixing upptime's structural
weaknesses.

## Problem it solves

upptime's design has four structural flaws StatusBeam eliminates:

1. **Client-side rate limits.** upptime's page calls the GitHub API from the
   visitor's browser (unauthenticated, 60 req/h/IP), so popular pages break with
   "rate limit exceeded". StatusBeam renders every byte at the edge from its own
   store — the browser never talks to a third-party API.
2. **Unreliable scheduling.** upptime rides GitHub Actions cron (best-effort; a
   "every 5 min" job can slip 15–60 min). StatusBeam uses Cloudflare Cron
   Triggers, which fire on time.
3. **A store that does not scale.** upptime treats git commit history as its
   database and walks it through a rate-limited API. StatusBeam uses Cloudflare
   D1 + KV, purpose-built for time-series reads.
4. **An end-of-life frontend.** upptime is built on Svelte 3 + Sapper (both EOL).
   StatusBeam is Astro + shadcn/ui.

## Target users

- **Small teams / solo maintainers** who want a public status page without
  running or paying for servers.
- **Open-source projects** that outgrew upptime's browser-side rate limits.
- **Anyone on Cloudflare** who wants uptime monitoring co-located with their edge
  platform (D1, KV, Queues, Cron Triggers).

## Core capabilities

Split into three independent layers, each deployable and replaceable on its own:

1. **Check layer** — Cloudflare Cron Worker. Pings every configured service on
   schedule, derives up / degraded / down from status + response time, writes
   time-series to D1 and the current snapshot to KV, and on a status change
   dispatches notifications and purges the page/badge cache by tag.
2. **Display layer** — Astro site with a shadcn/ui component set and a severity
   token system. Renders 90-day adaptive uptime bars, per-component
   response-time charts, and an incident timeline — all at the edge.
3. **Notify layer** — Slack + generic webhooks dispatched inline on status
   change (via `ctx.waitUntil`); a Cloudflare Queues upgrade path is planned but
   not yet wired up (see ARCHITECTURE.md).

Shipped: HTTP checks, D1 time-series + KV snapshot, 90-day uptime bars, Slack +
webhook notifications, edge cache purge-on-change, shields.io badges + JSON
status API, and a Statuspage adapter. The response-time charts and the incident
timeline (Investigating → Identified → Monitoring → Resolved) ship as UI + schema,
but the check worker does not yet persist `responseHistory` or the `incidents` KV
key. Until that persistence is wired up, production behaves differently per view:
the response-time chart is simply hidden when `responseHistory` is absent, while
the incident timeline falls back to bundled sample incidents.

## Roadmap (planned)

- TCP/SSL checks (config + schema already accept them)
- Scheduled maintenance entries
- Notify layer part 2: email + RSS/Atom feeds
- Migration guide for importing an existing `.upptimerc.yml`
- Vercel adapter path as a documented alternative to Cloudflare

## Constraints & principles

- **Zero servers to babysit** — everything runs on Cloudflare's edge primitives.
- **Config-as-YAML** — a single `status.config.yml` drives the whole instance.
- **Edge-first rendering** — the visitor's browser never calls a third-party API.
- **Open source, MIT-licensed** — published under the `pleaseai` org.
