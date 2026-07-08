---
name: statuspage-provider-label-gap
description: When adding a new check kind that shares checkStatuspage (e.g. incidentio), verify ALL three error paths get the provider label, not just the two inline in checkStatuspage
metadata:
  type: project
---

In `packages/core/src/check.ts`, `checkStatuspage` produces three distinct error
strings: (1) `${provider} API returned ${res.status}`, (2) `${provider}
summary.json failed validation: ...`, and (3) a component-not-found error thrown
from `deriveStatuspageStatus` (`Statuspage component not found: ${component}`).

The `incident.io` adapter (added 2026-07) first introduced a `provider` local
(`'incident.io'` vs `'Statuspage'`) and substituted it into paths (1) and (2)
only — commit 5959a0d left `deriveStatuspageStatus` hardcoding `"Statuspage
component not found"` regardless of `site.check`. That gap was caught in review
and **closed in the same PR** (commit dd91438): `deriveStatuspageStatus` now
takes a `provider = 'Statuspage'` parameter and `checkStatuspage` passes it, so
all three error paths carry the configured provider. At HEAD an `incidentio`
site with a missing `component` correctly returns `"incident.io component not
found: ..."` (covered by a test in `check.test.ts`).

**Why:** `deriveStatuspageStatus` is a small pure function reused by both check
kinds; the two inline template strings in `checkStatuspage` are easy to update
while forgetting the third message, which lives one function away and is
surfaced via a caught exception rather than a literal in the same function body.
That's exactly the trap 5959a0d fell into before dd91438 fixed it.

**How to apply:** When reviewing a future PR that adds another
`checkStatuspage`-sharing check kind, or touches `deriveStatuspageStatus`,
verify the component-not-found path threads `provider` too (call
`deriveStatuspageStatus(summary, component, provider)`, not the two-arg form).
Because the gap is now closed, a new check kind that omits the provider label on
*any* of the three paths — including component-not-found — is a **fresh
regression**, not a pre-existing gap to wave through.
