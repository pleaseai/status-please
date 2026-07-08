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

## Update (2026-07-08): repo renamed to statusbeam, feed.ts reviewed

The project (npm name `statusbeam`, package `@statusbeam/core`) is the same codebase —
just renamed from `status-please`. Reviewed `packages/core/src/feed.ts` (`FeedMeta`,
`buildRssFeed`/`buildAtomFeed`) and `apps/web/src/lib/feed.ts` (`FeedKind`,
`CONTENT_TYPE`) on branch `amondnet/feed`.

- **`FeedKind = keyof typeof CONTENT_TYPE` is the strong pattern to point to as a
  positive example** in future reviews here. Deriving the closed union from a
  `const` object's keys means the union and the content-type map can never drift
  apart — a good instance of "make illegal states unrepresentable" via TS. Contrast
  this with the exhaustive `switch` style in `types.ts` (`toSeverity`,
  `overallSeverity`) which gets a *different* kind of compile-time safety (missing
  `return` on an unhandled case is a type error). A ternary consuming a >2-member
  closed union (as `feedResponse` does for the current 2-member `FeedKind`) does
  **not** get that same exhaustiveness protection — flag this pattern (ternary
  instead of switch/`satisfies never`) if `FeedKind`/similar unions ever grow a
  third member, but it's a non-issue at exactly 2 members.

- **Confirmed real bug class, not just theoretical: unvalidated epoch-ms fields
  passed straight into `Date#toISOString()`/`toUTCString()`.** `FeedMeta.now?:
  number` (`packages/core/src/feed.ts:20`) has zero validation. `new
  Date(NaN).toISOString()` throws `RangeError: Invalid time value` (crashes the
  whole feed response), while `new Date(NaN).toUTCString()` silently returns the
  string `"Invalid Date"` (malformed but non-throwing) — verified by direct
  `node -e` repro during this review. `buildAtomFeed` uses `.toISOString()`, so a
  bad `now` crashes; `buildRssFeed` uses `.toUTCString()`, so a bad `now` silently
  corrupts output. This is currently latent (the only production caller,
  `feedResponse` in `apps/web/src/lib/feed.ts`, never sets `now`), but it's a real
  gap relative to this same file's own `formatUpdateTime`, which explicitly guards
  `Number.isNaN` for exactly this reason. Worth re-checking if a future caller
  wires `now` from anything other than a literal `Date.now()`/`Date.parse`.

- **`feedHost()` (`packages/core/src/feed.ts:100-108`) follows the established
  silent-fallback convention** (see the badge.ts note above) — `new
  URL(siteUrl).host` wrapped in try/catch, falling back to the raw string on parse
  failure. Consistent with house style; not a novel issue, but combined with
  `FeedMeta`'s doc-only "absolute, no trailing slash" invariant on `siteUrl`/
  `feedUrl` (never enforced by a smart constructor — `FeedMeta` is a plain
  exported interface, constructed ad hoc in `feedResponse`), a malformed
  `siteUrl` degrades to visibly-broken but non-crashing feed XML (e.g. double
  slashes, garbage `tag:` URIs) rather than being rejected. Since `FeedMeta` is
  re-exported from `packages/core/src/index.ts` as public API, any future
  self-hosted caller that doesn't derive it from `url.origin` (which the WHATWG
  URL API guarantees is trailing-slash-free) inherits this gap.
