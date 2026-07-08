---
title: Configuration
description: The single status.config.yml file — services, check types, notifications, and theme.
---

import { Aside } from '@astrojs/starlight/components';

StatusBeam is configured by a **single YAML file**, `status.config.yml`. At
deploy time you upload it to the Worker's KV `config` key; that is the only thing
you configure.

<Aside type="tip">
  Start from `status.config.example.yml` in the repo: `cp
  status.config.example.yml status.config.yml`.
</Aside>

## Example

```yaml
name: Acme Status

sites:
  - name: Website
    url: https://example.com
    check: http # http | tcp | ssl | statuspage
    expectedStatusCodes: [200]
    maxResponseTime: 2000 # ms; slower responses are marked "degraded"
  - name: API
    url: https://api.example.com/health
    check: http

  # Read status straight from an Atlassian Statuspage. `url` is the page's base
  # URL; StatusBeam appends /api/v2/summary.json automatically.
  - name: Claude
    url: https://status.claude.com
    check: statuspage
  # Add `component` to track one service on the page instead of the whole page.
  - name: Claude API
    url: https://status.claude.com
    check: statuspage
    component: Claude API (api.anthropic.com)

notifications:
  slack:
    webhookUrl: https://hooks.slack.com/services/T00000000/B00000000/XXXX
  webhooks:
    - url: https://example.com/status-hook

theme:
  logoUrl: /logo.svg
  darkMode: true
  locale: en # en | zh | ja | ko — fallback UI language
```

## Fields

### `sites[]`

| Field                 | Type       | Notes                                                              |
| --------------------- | ---------- | ------------------------------------------------------------------ |
| `name`                | string     | Display name for the service.                                      |
| `url`                 | string     | Endpoint to check (or Statuspage base URL for `check: statuspage`).|
| `check`               | enum       | `http` \| `tcp` \| `ssl` \| `statuspage`.                          |
| `expectedStatusCodes` | number[]   | Codes treated as healthy (HTTP checks).                            |
| `maxResponseTime`     | number     | Milliseconds; slower responses are marked **degraded**.            |
| `component`           | string     | For `statuspage`: track one component by name (case-insensitive) or id. |

### `notifications`

- `slack.webhookUrl` — incoming webhook for a Slack channel.
- `webhooks[].url` — arbitrary HTTP endpoints that receive status-change events.

<Aside type="caution">
  Keep real webhook URLs out of the committed example — they are secrets. Put
  them only in the private config you upload to KV.
</Aside>

### `theme`

- `logoUrl` — logo shown on the page.
- `darkMode` — enable the dark theme.
- `locale` — fallback UI language (`en` | `zh` | `ja` | `ko`), used only when a
  visitor's browser language isn't one of the supported locales.
