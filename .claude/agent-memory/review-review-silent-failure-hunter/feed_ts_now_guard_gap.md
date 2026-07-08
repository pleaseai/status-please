---
name: feed-ts-now-guard-gap
description: statusbeam packages/core/src/feed.ts commit 33dfec5 — Number.isFinite(meta.now) guard is reproducibly incomplete; a finite-but-out-of-Date-range now still reintroduces both original bugs (RangeError crash in buildAtomFeed, literal "Invalid Date" text in buildRssFeed)
metadata:
  type: project
---

## `Number.isFinite(meta.now)` is not the same check as "constructing a Date from it won't blow up"

In `packages/core/src/feed.ts` (`buildAtomFeed`/`buildRssFeed`), commit
`33dfec5` fixed a RangeError/"Invalid Date" bug for malformed *incident*
timestamps via a `toMs(iso, fallback)` helper that builds a `Date` and checks
`Number.isNaN(d.getTime())`. That check is correct and sound.

But the *separate* guard added for `meta.now` itself uses a different (and
incomplete) check:

```ts
const buildMs = Number.isFinite(meta.now) ? (meta.now as number) : Date.now()
const updated = new Date(buildMs).toISOString()   // buildAtomFeed
const buildDate = new Date(buildMs).toUTCString() // buildRssFeed
```

`Number.isFinite` only rejects `NaN`/`±Infinity`. It does **not** reject a
finite JS number outside `Date`'s representable range (±8,640,000,000,000,000
ms, i.e. roughly ±100,000 days from epoch). For such a value, `new
Date(x).getTime()` is `NaN` (Invalid Date) even though `Number.isFinite(x)` is
`true`.

**Verified by reproduction** (`bun test`, ad hoc):
- `buildAtomFeed([], { ...meta, now: 1e20 })` → **throws `RangeError: Invalid
  time value`** — the exact crash this commit's own commit message says it
  eliminated, just triggered via `meta.now` instead of an incident timestamp.
- `buildRssFeed([], { ...meta, now: 1e20 })` → does **not** throw, but emits
  the literal string `Invalid Date` in `<lastBuildDate>` — the exact other bug
  this commit's message says it eliminated.

No test added in this commit exercises an out-of-range-but-finite `now`
(only `Number.NaN` is tested), so this gap shipped uncaught.

**Why it matters:** `FeedMeta`/`buildAtomFeed`/`buildRssFeed` are exported
from the public `@statusbeam/core` package — any external caller (or a future
internal caller deriving `now` from unvalidated input) can retrigger both
original bugs through this one remaining seam. Today's only internal caller
(`apps/web/src/lib/feed.ts` `feedResponse`) never sets `meta.now`, so it's not
reachable in production as currently wired — but it is a live footgun in a
published library API, not a theoretical one.

**How to apply / suggested fix:** don't validate the raw number with
`Number.isFinite`; validate the *resulting Date*, the same pattern `toMs`
already uses correctly, e.g.:

```ts
function validMs(candidate: number | undefined, fallback: number): number {
  if (candidate === undefined) return fallback
  const ms = new Date(candidate).getTime()
  return Number.isNaN(ms) ? fallback : ms
}
const buildMs = validMs(meta.now, Date.now())
```

If this repo's `feed.ts` is revisited again, check whether this has been
fixed before re-flagging; if unfixed, this is a high-confidence (~90),
easily-reproducible finding, not speculative.

See also [[status_please_conventions]] for this repo's general logging/error
conventions (no Sentry/logError; plain `console.warn` in `apps/web`/`apps/worker`,
but `packages/core` — including `feed.ts` — has zero logging anywhere, which is
consistent with it being a pure library; the caller layer would be the right
place to log if malformed KV data is ever detected, but currently doesn't).
