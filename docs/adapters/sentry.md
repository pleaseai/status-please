# Sentry adapter

Mirror status from a **[Sentry Uptime](https://docs.sentry.io/product/uptime-monitoring/)**
monitor. Sentry runs the uptime checks (from its own infrastructure, roughly once
a minute) and StatusBeam presents the verdict on your public status page — so you
reuse the monitoring you already have in Sentry instead of probing the endpoint a
second time yourself.

Unlike the [Statuspage](./statuspage.md) / [incident.io](./incidentio.md)
adapters, Sentry has **no public "current status" endpoint**. A failing uptime
check surfaces as a Sentry **issue** (the `outage` category); recovery resolves
it. StatusBeam therefore integrates with that issue lifecycle two ways:

- **Webhook (primary, real-time).** Sentry pushes an issue webhook when the uptime
  issue opens or resolves; StatusBeam maps it to `up`/`down` in seconds. This is
  the precise path and the recommended way to run the adapter.
- **Poll backstop (optional).** On the cron schedule, StatusBeam reads Sentry's
  Issues API and grades the monitor `down` while an unresolved outage issue
  exists. Requires a `SENTRY_AUTH_TOKEN`. Best-effort — see
  [Poll backstop](#poll-backstop-optional).

Sentry Uptime is **binary** — a monitor is failing or it isn't — so this adapter
only ever reports `up` or `down` (never `degraded`).

## When to use it

- You already monitor an endpoint with Sentry Uptime and want its verdict on your
  public status page without wiring a second probe.
- You want Sentry's multi-region checks and issue/alert workflow to be the source
  of truth, with StatusBeam as the presentation layer.

For a service you'd rather probe directly, a plain
[`http`](../../README.md#check-types) check is the simpler fit.

## Configuration

```yaml
sites:
  # Webhook-only (recommended): status comes purely from the Sentry webhook.
  # The cron loop skips this site, so it never records a false `down`.
  - name: API
    url: https://api.example.com
    check: sentry

  # With the poll backstop: cron also reads Sentry's Issues API. Needs a
  # SENTRY_AUTH_TOKEN on the Worker (a secret — never put it in this file).
  - name: Web
    url: https://www.example.com
    check: sentry
    sentry:
      org: my-org # required to enable polling
      project: web # optional: scope the query to one project
      query: 'is:unresolved issue.category:outage' # optional override
      host: https://us.sentry.io # optional: region or self-hosted host
```

| Field            | Required | Meaning                                                                                                             |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `check`          | yes      | Must be `sentry`.                                                                                                   |
| `url`            | yes      | The monitored URL — display only. The verdict comes from Sentry, not from fetching this URL.                       |
| `name`           | yes      | Display name on your status page.                                                                                  |
| `sentry`         | no       | Present ⇒ enable the [poll backstop](#poll-backstop-optional); absent ⇒ **webhook-only** (cron skips the site). Only valid with `check: sentry`. |
| `sentry.org`     | yes\*    | Sentry organization slug. \*Required **when** the `sentry` block is present.                                       |
| `sentry.project` | no       | Project id or slug to scope the issue query.                                                                       |
| `sentry.query`   | no       | Override the issue search query. Defaults to `is:unresolved issue.category:outage`.                                |
| `sentry.host`    | no       | API host for a Sentry region (`https://us.sentry.io`, `https://de.sentry.io`) or self-hosted install. Defaults to `https://sentry.io`. |

`expectedStatusCodes` and `maxResponseTime` are ignored for `sentry` checks — the
verdict is Sentry's, not derived from an HTTP code or latency.

## Real-time updates via webhooks

The webhook is the **primary** path for this adapter (for Statuspage it's an
optional accelerator; for Sentry it's how the integration is meant to run).

### How it works

The check Worker serves `POST /webhooks/sentry/:slug`, where `:slug` is a
configured `check: sentry` site. When Sentry pushes an issue webhook, StatusBeam
maps it to a status, records a check row, refreshes the snapshot, fires
notifications, and purges the edge cache — exactly as a cron check does. The
verdict is derived from the issue lifecycle
([`packages/core/src/sentry-webhook.ts`](../../packages/core/src/sentry-webhook.ts)):

| Sentry webhook                                              | StatusBeam |
| ---------------------------------------------------------- | ---------- |
| `action: created` / `triggered`, or `issue.status: unresolved` | `down`     |
| `action: resolved`, or `issue.status: resolved`            | `up`       |
| anything else (e.g. an `ignored`/muted issue)              | ignored (`204`) |

### Setup

1. **Set a shared secret** on the check Worker — the endpoint authenticates on a
   `?token=` in the URL:

   ```bash
   cd apps/worker
   wrangler secret put WEBHOOK_SECRET   # paste a long random value: openssl rand -hex 32
   ```

   Until it's set, the endpoint fails closed — every request returns `401`.

2. **Create an alert that notifies a webhook.** In Sentry, Uptime/Crons
   notifications are sent by an **issue alert** filtered to the `outage` issue
   category. Create an
   [Internal Integration](https://docs.sentry.io/organization/integrations/integration-platform/internal-integration/)
   (Settings → Developer Settings) with a **webhook URL** and the **Issue**
   webhook enabled, then point an issue alert at it — or use whatever alert route
   delivers a webhook on issue open/resolve. Register one URL per tracked site:

   ```
   https://<your-worker>.workers.dev/webhooks/sentry/<slug>?token=<secret>
   ```

   For the `API` example above the slug is `api`.

> **One monitor per site.** StatusBeam maps an inbound webhook to a site by the
> URL's `:slug`, not by inspecting which monitor the issue is about. Register a
> distinct webhook URL (distinct slug) per uptime monitor so each site gets only
> its own events.

### Responses

| Situation                                                | Status |
| -------------------------------------------------------- | ------ |
| Event carries an up/down transition for this site        | `200`  |
| Valid event with no transition (e.g. an ignored issue)    | `204` (acked, ignored) |
| Missing or wrong `?token=` (or `WEBHOOK_SECRET` unset)    | `401`  |
| Unknown slug, or a site that isn't a `sentry` check       | `404`  |
| Body isn't valid JSON, or fails shape validation          | `400`  |
| Non-`POST` method on the route                            | `405`  |

## Poll backstop (optional)

Add a `sentry:` block **and** set `SENTRY_AUTH_TOKEN` on the Worker to have the
cron loop also poll Sentry as a backstop. It reads the Issues API
([`packages/core/src/sentry.ts`](../../packages/core/src/sentry.ts)):

```
GET {host}/api/0/organizations/{org}/issues/?query={query}&project={project}&limit=1
Authorization: Bearer $SENTRY_AUTH_TOKEN
```

If the search returns an unresolved outage issue → `down`; otherwise → `up`.

```bash
cd apps/worker
wrangler secret put SENTRY_AUTH_TOKEN   # a Sentry auth token with read access to issues
```

Create the token in Sentry under **Settings → Auth Tokens** (or the internal
integration above) with issue read scope.

**Webhook-only vs. backstop.** Because a `check: sentry` site may be webhook-only,
the cron loop **skips** any `check: sentry` site that has no `sentry:` block or
when `SENTRY_AUTH_TOKEN` is unset — otherwise polling would record a false `down`
every tick and clobber the webhook-driven status. A skipped site keeps its
previous status in the snapshot.

**Precision.** Sentry has no per-monitor status endpoint, so the backstop is only
as precise as the `query`. The default (`is:unresolved issue.category:outage`)
matches *any* outage issue in scope; if a project has several uptime monitors,
narrow `query` (e.g. add the monitored host) or set `project` so the backstop
grades the right one. The webhook path is always precise.

## Failure & edge behavior

Every outcome below produces a normal `CheckResult`, so it flows into the D1
time-series, KV snapshot, badges, and notifications like any other check. (Applies
to the poll backstop; webhook responses are in [Responses](#responses) above.)

| Situation                                     | `status` | `code`            | `error`                                     |
| --------------------------------------------- | -------- | ----------------- | ------------------------------------------- |
| No unresolved outage issue                    | `up`     | `200`             | —                                           |
| An unresolved outage issue exists             | `down`   | `200`             | —                                           |
| `SENTRY_AUTH_TOKEN` / `sentry` block missing  | `down`   | `0`               | `Sentry poll not configured …`              |
| Sentry API returns non-2xx (bad token, etc.)  | `down`   | actual (e.g. `403`) | `Sentry API returned 403`                   |
| Body isn't the expected JSON array            | `down`   | `200`             | `Sentry issues payload failed validation …` |
| Request never completes (DNS/TLS/timeout)     | `down`   | `0`               | the thrown error message                    |

As with the Statuspage adapter, `code` reflects whether the HTTP request
completed: a config problem (missing token, bad auth) is deterministic, while a
genuine network outage records `code: 0`.

## Notes & limitations

- **Binary only.** Sentry Uptime is up-or-down; this adapter never reports
  `degraded`.
- **No degraded/latency grading.** `maxResponseTime` doesn't apply — the poll's
  `responseTime` measures the Sentry API call, not your service.
- **Incidents aren't ingested.** Only the current status is read. Sentry's issue
  timeline is not imported into StatusBeam's own incident timeline.
- **Trusted config.** `url`, `org`, and `query` come from your committed
  `status.config.yml`; the token is a Worker secret and never lives in the config.

## How it fits together

The poll adapter lives in
[`packages/core/src/sentry.ts`](../../packages/core/src/sentry.ts) (`checkSentry`),
dispatched from `checkSite` on `site.check === 'sentry'`
([`packages/core/src/check.ts`](../../packages/core/src/check.ts)); the token is
injected by the Worker from `SENTRY_AUTH_TOKEN` so core stays framework-free. The
config schema (`checkKindSchema`, the `sentry` block) is in
[`packages/core/src/config.ts`](../../packages/core/src/config.ts).

The [webhook path](#real-time-updates-via-webhooks) maps an inbound payload to a
`CheckStatus` in
[`packages/core/src/sentry-webhook.ts`](../../packages/core/src/sentry-webhook.ts),
and the Worker's shared `fetch` handler
([`apps/worker/src/webhook.ts`](../../apps/worker/src/webhook.ts)) — the same
`POST /webhooks/:provider/:slug` router that serves Statuspage — turns it into a
`CheckResult` and feeds the shared `ingest` pipeline, so a pushed update and a
polled one are indistinguishable downstream.
