---
title: Introduction
description: What StatusBeam is, how the three-layer architecture works, and why it runs entirely on Cloudflare.
---

**StatusBeam** monitors your services, records their uptime as durable
time-series data, and publishes a fast, good-looking status page to the edge. It
keeps the parts of [upptime](https://github.com/upptime/upptime) people love —
config-as-YAML, zero servers to babysit, badges, a public JSON API — while
fixing upptime's biggest structural weaknesses.

## Architecture

StatusBeam is deliberately split into three independent layers. Each can be
understood, deployed, and replaced on its own.

1. **Check layer — Cloudflare Cron Worker.** Cron Triggers ping every configured
   service on schedule, derive `up` / `degraded` / `down` from the status code
   and response time, write time-series to D1 and the current snapshot to KV, and
   on a status change enqueue a notification and purge the page/badge cache by tag.
2. **Notify layer — Queue consumer.** Fans out status changes to Slack, webhooks,
   and (soon) email and RSS/Atom.
3. **Display layer — Astro site on Cloudflare.** Renders the page at the edge
   from D1/KV — the browser never calls a third-party API, so there are no client
   rate limits. Fronted by Workers Cache; the check layer purges by tag on change,
   so updates are near-instant rather than TTL-bound.

Because the check and display layers live on Cloudflare — **not** on the
infrastructure being monitored — your status page stays up even when your own
services are down. That resilience is the whole point of a status page.

## Next steps

- [Quick Start](/getting-started/quick-start/) — get a page running locally.
- [Configuration](/guides/configuration/) — the single `status.config.yml` file.
- [Deploy to Cloudflare](/guides/deployment/) — provision D1/KV and ship it.
