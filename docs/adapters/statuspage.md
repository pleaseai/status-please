# Statuspage adapter

Mirror status straight from any **Atlassian Statuspage** — `status.claude.com`,
`www.vercel-status.com`, `*.statuspage.io`, and the thousands of vendor pages
built on Statuspage — instead of probing an endpoint yourself.

A regular `http` check tells you whether _your_ request succeeded. The
`statuspage` check instead reads the vendor's own published verdict: one request
to their `/api/v2/summary.json` returns the overall page indicator plus every
component, and status-please maps that to its `up` / `degraded` / `down` model.

## When to use it

- You depend on a third-party service (Claude, Vercel, GitHub, Stripe, …) that
  publishes an Atlassian Statuspage, and you want _their_ assessment of an
  incident rather than a naive reachability ping.
- You want per-service granularity — e.g. track only "Claude API
  (api.anthropic.com)" from a page that also lists the web app, Console, and
  other components.

For a service you operate yourself, a plain [`http`](../../README.md#configuration)
check is usually the better fit.

## Configuration

```yaml
sites:
  # Whole page: grade by the page's overall indicator.
  - name: Claude
    url: https://status.claude.com
    check: statuspage

  # Single component: grade by one service on the page.
  - name: Claude API
    url: https://status.claude.com
    check: statuspage
    component: Claude API (api.anthropic.com)
```

| Field       | Required | Meaning                                                                                                     |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `check`     | yes      | Must be `statuspage`.                                                                                       |
| `url`       | yes      | The Statuspage **base URL**. `/api/v2/summary.json` is appended automatically (see [URL derivation](#url-derivation)). |
| `component` | no       | Track a single component instead of the whole page. Matched by **name** (case-insensitive) or **id**. When omitted, the page's overall indicator is used. Only valid with `check: statuspage` — setting it on another check kind is a parse error (guards against a mistyped `check`). |
| `name`      | yes      | Display name on your status page (as with any site).                                                       |

`expectedStatusCodes` and `maxResponseTime` are ignored for `statuspage` checks —
the verdict comes entirely from the payload, not from the HTTP code or latency of
the API call (see [Notes](#notes--limitations)).

### URL derivation

`url` is normally the page's base URL and status-please builds the API endpoint
for you:

| Configured `url`                              | Requested endpoint                                        |
| --------------------------------------------- | --------------------------------------------------------- |
| `https://status.claude.com`                   | `https://status.claude.com/api/v2/summary.json`           |
| `https://www.vercel-status.com/` (trailing /) | `https://www.vercel-status.com/api/v2/summary.json`       |
| `https://status.claude.com/api/v2/status.json`| used verbatim (already an `/api/v2/*.json` endpoint)       |

The last row is an escape hatch: if you point `url` directly at an `/api/v2/*.json`
endpoint, it is used as-is. In practice you should keep `url` as the base URL and
let the adapter target `summary.json`, because only `summary.json` carries the
component list that `component` matching needs.

## Finding a component name or id

Open the page's component list and copy the exact `name` (or the stable `id`):

```bash
curl -s https://status.claude.com/api/v2/components.json \
  | jq -r '.components[] | "\(.id)  \(.status)  \(.name)"'
```

Use either value for `component:`. Name matching is case-insensitive and trims
surrounding whitespace; id matching is exact. If your service name contains YAML
special characters, quote it: `component: "Claude API (api.anthropic.com)"`.

## Status mapping

status-please has three states — `up`, `degraded`, `down`. Statuspage's richer
vocabulary is folded in as follows.

**Overall page indicator** (used when no `component` is set):

| Statuspage `status.indicator` | status-please |
| ----------------------------- | ------------- |
| `none`                        | `up`          |
| `minor`                       | `degraded`    |
| `major`                       | `down`        |
| `critical`                    | `down`        |
| `maintenance`                 | `degraded`    |

**Component status** (used when `component` matches one service):

| Statuspage component `status` | status-please |
| ----------------------------- | ------------- |
| `operational`                 | `up`          |
| `degraded_performance`        | `degraded`    |
| `partial_outage`              | `degraded`    |
| `major_outage`                | `down`        |
| `under_maintenance`           | `degraded`    |

Any **unrecognized** status/indicator string (a future Atlassian value, a
renamed state) maps to `degraded` — a deliberate, safe default: it surfaces that
something is off without ever silently reporting `up`.

## Failure & edge behavior

Every outcome below produces a normal `CheckResult`, so it flows into the D1
time-series, KV snapshot, badges, and notifications like any other check.

| Situation                                   | `status` | `code`              | `error`                                        |
| ------------------------------------------- | -------- | ------------------- | ---------------------------------------------- |
| Component/page reads healthy                | `up`     | 2xx (normally `200`)| —                                              |
| Component/page reads degraded/down          | mapped   | 2xx (normally `200`)| —                                              |
| `component` not found on the page           | `down`   | 2xx (normally `200`)| `Statuspage component not found: <name>`       |
| API returns non-2xx                         | `down`   | actual (e.g. `503`) | `Statuspage API returned 503`                  |
| Body isn't a JSON object (e.g. `null`, HTML)| `down`   | 2xx (normally `200`)| `Statuspage summary.json was not a JSON object` / parse error |
| Request never completes (DNS/TLS/timeout)   | `down`   | `0`                 | the thrown error message                       |

The `code` column holds the response's real HTTP status (`res.status`); it is
`200` for a normal healthy page but reflects whatever 2xx the API actually
returned.

The key distinction: `code` reflects **whether the HTTP request completed**.
A misconfigured `component` (a typo) fails _after_ a successful response, so it
records the real 2xx code — deterministic and repeatable on every cron run —
whereas a genuine network outage records `code: 0`. This keeps a persistent
config mistake from masquerading as transient flakiness in your history.

> **Tip:** if a `statuspage` site shows `down` with `code: 200` and a
> "component not found" error, it's almost always a typo in `component:` — check
> the exact name via `components.json` above.

## Notes & limitations

- **Latency is not graded.** `responseTime` is recorded (it measures the
  `summary.json` call), but a slow status-page API doesn't mean the monitored
  service is slow, so it never affects the verdict. Contrast with `http` checks,
  where `maxResponseTime` marks a site `degraded`.
- **One component per site entry.** To track several components from the same
  page, add one `site` entry per component (they share the same `url`).
- **Incidents aren't ingested yet.** Only the current status is read. The
  vendor's incident history and scheduled maintenances in `summary.json` are not
  imported into status-please's own incident timeline.
- **Trusted config.** `url` comes from your committed `status.config.yml`, not
  from end users; it's validated as a URL at parse time.

## How it fits together

The adapter lives in [`packages/core/src/check.ts`](../../packages/core/src/check.ts):
`checkSite` dispatches on `site.check`, and `checkStatuspage` handles the fetch,
shape-guarding, and grading via `deriveStatuspageStatus`. The config schema
(`checkKindSchema`, the optional `component` field) is in
[`packages/core/src/config.ts`](../../packages/core/src/config.ts). The Cron
Worker calls `checkSite` for every configured site — no adapter-specific wiring
is needed downstream, because the adapter returns the same `CheckResult` shape as
every other check.
