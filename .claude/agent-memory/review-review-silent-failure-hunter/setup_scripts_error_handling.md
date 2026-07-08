---
name: setup-scripts-error-handling
description: Error-handling shape of scripts/setup.sh + scripts/apply-config.ts (PR #22) — D1/KV lookup swallow pattern and apply-config.ts's warn-only fallback
metadata:
  type: project
---

## scripts/setup.sh — D1/KV id lookup (lines ~92-126)

`lookup_d1`/`lookup_kv` pipe `wr d1 list --json 2>/dev/null | bun -e '...'` and every
call site wraps the result in `D1_ID="$(lookup_d1 || true)"`. The final
`[ -n "$D1_ID" ] || die "..."` guards (setup.sh:114, :125) DO cover the "proceed
with an empty id" case — script won't silently continue into deploy with a
blank id. What they don't cover: the `2>/dev/null` + `|| true` combo discards
*why* the lookup failed (auth expiry, rate limit, wrangler JSON shape change).
If the first lookup transiently fails while the resource already exists, the
script takes the "create new" branch and either hits a confusing "already
exists" wrangler error (root cause masked) or risks creating a duplicate
resource. Not flagged as a full silent-failure (it does eventually die/error),
but a diagnosability + possible-duplication issue. See [[status_please_conventions]].

## scripts/apply-config.ts — setNetworking warn-only fallback (line 84-85)

Three-tier placement strategy (managed-block regex → shipped "Custom domain:"
comment regex → `compatibility_flags` anchor). If all three miss, it does
`console.warn(...)` and returns the string **unchanged** — no throw, no
non-zero exit. `edit()` (line 29-36) treats "unchanged" as a legitimate no-op,
so `bun scripts/apply-config.ts` exits 0 and setup.sh's `set -e` never catches
it. setup.sh immediately prints a green "configured" ok line (setup.sh:141)
right after, burying/contradicting the warning. Real-world trigger requires
hand-editing wrangler.jsonc to remove the managed markers, the shipped
"Custom domain:" comment, AND `compatibility_flags` all at once — narrow, but
the shipped default networking value is the maintainer's own real demo domain
(`demo.status.pleaseai.dev` in apps/web/wrangler.jsonc), so if it ever
triggers with a user-requested custom domain, the web Worker would deploy
under the wrong domain while the operator believes setup succeeded.

`setCron` (apply-config.ts:88-93), by contrast, has *no* warning at all on
regex-mismatch — silently leaves the old cron value. Inconsistent with
setNetworking's (partial) diligence.

**How to apply:** if scripts/setup.sh or scripts/apply-config.ts are touched
again, check whether the warn-only fallback in setNetworking was ever changed
to actually fail loudly (recommended fix: throw/process.exit(1) so setup.sh's
set -e aborts before the deploy steps), and whether setCron got a matching
warn-on-mismatch branch.

kv:config / db:apply:remote / deploy steps (setup.sh:173,177,181) run without
`|| true` under `set -euo pipefail` — failures there ARE surfaced correctly,
confirmed by reading, not assumed.
