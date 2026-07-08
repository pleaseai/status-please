# incident.io adapter

Mirror status straight from any **incident.io status page** — `status.openai.com`,
`status.incident.io`, and any page built on incident.io's Status Pages product —
instead of probing an endpoint yourself.

incident.io status pages serve a **Statuspage-compatible** `/api/v2/summary.json`:
the same overall page indicator plus per-component payload that Atlassian
Statuspage publishes. So `check: incidentio` reuses the exact same fetch,
shape-guarding, and grading as the [`statuspage`](./statuspage.md) adapter — it's
a first-class, self-documenting alias with the provider named in error messages.

## When to use it

- You depend on a service (OpenAI, Retool, …) that publishes an **incident.io**
  status page and you want _their_ assessment of an incident rather than a naive
  reachability ping.
- You want per-service granularity — track a single component from a page that
  lists several.

If you're not sure which product a page runs on, it doesn't much matter:
`incidentio` and [`statuspage`](./statuspage.md) read the identical payload and
grade it identically. Pick the one that names the vendor you're monitoring; the
only observable difference is the provider label in error strings (e.g.
`incident.io API returned 503`).

## Configuration

```yaml
sites:
  # Whole page: grade by the page's overall indicator.
  - name: OpenAI
    url: https://status.openai.com
    check: incidentio

  # Single component: grade by one service on the page.
  - name: OpenAI API
    url: https://status.openai.com
    check: incidentio
    component: API
```

| Field       | Required | Meaning                                                                                                     |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `check`     | yes      | Must be `incidentio`.                                                                                       |
| `url`       | yes      | The status page **base URL**. `/api/v2/summary.json` is appended automatically. |
| `component` | no       | Track a single component instead of the whole page. Matched by **name** (case-insensitive) or **id**. When omitted, the page's overall indicator is used. Only valid with `check: statuspage` or `incidentio`. |
| `name`      | yes      | Display name on your status page (as with any site).                                                       |

`expectedStatusCodes` and `maxResponseTime` are ignored — the verdict comes
entirely from the payload, not the HTTP code or latency of the API call.

## Finding a component name or id

```bash
curl -s https://status.openai.com/api/v2/components.json \
  | jq -r '.components[] | "\(.id)  \(.status)  \(.name)"'
```

Use either the `name` (case-insensitive, trimmed) or the stable `id` for
`component:`. Quote names with YAML special characters.

## Status mapping, failure & edge behavior

Identical to the Statuspage adapter, because the payload is identical. See
[**Status mapping**](./statuspage.md#status-mapping) and
[**Failure & edge behavior**](./statuspage.md#failure--edge-behavior) in the
Statuspage guide for the full indicator/component tables and the `code: 0` vs.
`code: 200` distinction. The one difference: error messages name the provider
you configured — `incident.io API returned 503`,
`incident.io summary.json failed validation: …`, and
`incident.io component not found: <name>`.

## Notes & limitations

- **Statuspage-compatible endpoint.** This adapter reads incident.io's
  `summary.json`, which mirrors the Atlassian Statuspage schema. incident.io's
  native, incident-centric **Widget API** (`ongoing_incidents`, …) is _not_ used —
  `summary.json` gives a cleaner current-state verdict for our `up`/`degraded`/`down`
  model.
- **Incidents aren't ingested yet.** Only the current status is read; the
  vendor's incident history isn't imported into StatusBeam's own timeline.
- **Latency is not graded**, and it's **one component per site entry** — same as
  the Statuspage adapter.

## How it fits together

The adapter shares [`packages/core/src/check.ts`](../../packages/core/src/check.ts)
with `statuspage`: `checkSite` dispatches both `statuspage` and `incidentio` to
`checkStatuspage`, which handles the fetch, shape-guarding, and grading via
`deriveStatuspageStatus`. The config schema (`checkKindSchema`, the optional
`component` field) is in [`packages/core/src/config.ts`](../../packages/core/src/config.ts).
