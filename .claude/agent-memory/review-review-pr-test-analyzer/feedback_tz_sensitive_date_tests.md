---
name: feedback-tz-sensitive-date-tests
description: How to verify whether a date/timezone-formatting test actually exercises its stated UTC guarantee
metadata:
  type: feedback
---

When a function claims a UTC/timezone-correctness guarantee (e.g. `formatDay` in
`packages/core/src/i18n.ts`, which sets `timeZone: 'UTC'` in `Intl.DateTimeFormat` explicitly so a
day bucket "reads the same regardless of the viewer's timezone"), a test that only asserts the
formatted output under the *host machine's default TZ* does NOT actually verify that guarantee —
it will pass identically whether or not the `timeZone: 'UTC'` override is present, as long as CI's
host TZ happens to already be UTC (the common case for GitHub Actions runners).

**Why:** verified experimentally in this review (bun respects runtime `process.env.TZ` mutation for
`Intl.DateTimeFormat`):
```
process.env.TZ = 'America/Los_Angeles'
Intl.DateTimeFormat(..., { timeZone: 'UTC' }).format(Date.UTC(2026,6,5))   // "Jul 5, 2026" (correct)
Intl.DateTimeFormat(..., /* no timeZone */).format(Date.UTC(2026,6,5))     // "Jul 4, 2026" (bug)
```
So the *only* way to make a test actually catch a regression that drops the `timeZone: 'UTC'`
option is to set `process.env.TZ` to a non-UTC zone before calling the function under test.

**How to apply:** when reviewing (or writing) tests for any date-formatting function that claims
timezone independence, check whether the test suite ever varies `process.env.TZ`. If it doesn't,
flag it as a real (if narrow) coverage gap — moderate confidence/severity, not critical — and
suggest adding one assertion wrapped in a TZ override. This generalizes beyond this repo: any
`Intl.DateTimeFormat`/`Intl.RelativeTimeFormat` test whose correctness depends on an implicit
"UTC-safe" implementation detail should include at least one non-UTC-TZ run to be a real regression
guard, not just a snapshot of current CI environment behavior.
