---
name: status-please-badge-conventions
description: Type design conventions observed in status-please's packages/core (badge.ts, types.ts) and apps/web boundary validation
metadata:
  type: project
---

Repo `pleaseai/status-please` (worktree `badge`). `packages/core/src/badge.ts` builds
shields.io endpoint-badge JSON (`ShieldsEndpoint`) from the `SiteSummary` domain
type defined in `packages/core/src/types.ts`.

Established conventions in this codebase, useful context for future type-design
reviews here:

- **Boundary validation lives in the Astro route, not the core function.**
  `apps/web/src/pages/api/badge/[slug]/uptime.json.ts` parses the untrusted
  `?period=` query string through an allowlist (`PERIODS.includes(...)`) before
  ever constructing an `UptimePeriod`, so `uptimeBadge` itself never has to
  validate — it can assume the closed union is already true. Reviewers should
  check the call site for this pattern before flagging a "missing validation"
  issue in a core function that takes a closed union parameter.

- **`color: string` on `ShieldsEndpoint` is intentional, not a weakness.** shields.io
  accepts both named colors (`brightgreen`, `yellow`, ...) and raw `rrggbb` hex, so
  the field can't be a closed literal union without also modeling hex strings.
  The internal color functions (`severityColor`, `uptimeColor`, `responseColor`)
  each only ever return from a small fixed set of literal color names, so *their*
  return type could reasonably be a literal union for a stronger compile-time
  guarantee — but the codebase leans on exhaustive switches/if-chains with an
  explicit `string` return annotation (which already forces a compile error on a
  non-exhaustive switch) plus exact-value test assertions in `badge.test.ts` as
  the safety net instead. Treat "these color functions return bare `string`" as a
  minor/low-severity finding at most, not a real gap — it's a deliberate,
  consistent house style here.

- **Deliberate silent-fallback pattern on the request path.** `parseUptimePercent`
  returns `1` (100%, green) for unparseable input, with an explicit doc comment
  explaining the tradeoff: never throw while serving a badge request, degrade to
  the best-case display instead. Same shape as `windowUptime`/`formatUptime` in
  `types.ts` (empty/no-data windows also return the "healthy" default). This is a
  recurring, intentional pattern in this repo — don't flag it as a bug, at most
  note it as a minor observability gap (a corrupted snapshot silently shows
  green rather than surfacing an error).

See also [[status-please-project]] if present for the broader project context.
