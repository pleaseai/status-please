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

The `incident.io` adapter (added 2026-07, commit 5959a0d, "feat(core): add
incident.io status-page check adapter") introduced a `provider` local
(`'incident.io'` vs `'Statuspage'`) and substituted it into paths (1) and (2),
but `deriveStatuspageStatus` still hardcodes `"Statuspage component not found"`
regardless of `site.check`. Verified live: an `incidentio` site with a
mistyped/missing `component` returns `error: "Statuspage component not found:
..."`, contradicting both the check.ts doc comment ("only the error label
differing so a user sees the provider they configured") and
`docs/adapters/incidentio.md` ("error messages name the provider you
configured").

**Why:** `deriveStatuspageStatus` is a small pure function reused by both check
kinds; it's easy to update the two inline template strings in `checkStatuspage`
and forget the third message that lives one function away and is surfaced via
a caught exception rather than a literal in the same function body.

**How to apply:** When reviewing a future PR that adds another
`checkStatuspage`-sharing check kind, or touches `deriveStatuspageStatus`,
explicitly check whether the component-not-found message was updated too. If a
third provider is added without fixing this, treat it as the same pre-existing
gap, not a new one (unless the PR's own commit message/docs claim full
provider-label coverage, in which case it's a fresh discrepancy worth flagging).
