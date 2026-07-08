---
name: pr22-setup-script-review
description: Findings from reviewing PR #22 (scripts/setup.sh + scripts/apply-config.ts guided Cloudflare deploy) — known limitations to check on follow-up PRs touching these files
metadata:
  type: project
---

PR #22 added `scripts/setup.sh` (bash, interactive provision+configure+deploy) and
`scripts/apply-config.ts` (bun/TS, rewrites `apps/worker/wrangler.jsonc` and
`apps/web/wrangler.jsonc` via targeted regex string edits to preserve JSONC comments).

Reviewed against the actual wrangler CLI source (`node_modules/wrangler/wrangler-dist/cli.js`)
rather than assumption: `d1 list --json` returns raw objects with `uuid`/`name` fields,
`kv namespace list --json` returns raw objects with `id`/`title`; `kv namespace create <name>`
titles the namespace as exactly `<env-prefix><name><preview-suffix>` with **no worker-name
prefix**. The script's field assumptions (`d.uuid || d.id`, `x.title.endsWith("STATUS_KV")`)
are correct.

Known accepted limitation (flagged in review, not blocking — documented here so a future
reviewer doesn't re-derive it from scratch): `lookup_d1`/`lookup_kv` in `scripts/setup.sh`
match D1 databases/KV namespaces **by name only, account-wide** (`DB_NAME="status-please"`,
KV title `endsWith("STATUS_KV")`). If a single Cloudflare account ever hosts two
status-please deployments (e.g. a staging fork alongside prod), the second `setup.sh` run
will silently reuse the first deployment's D1/KV resources instead of creating its own —
there's no per-fork/per-worker namespacing in the lookup.

**Why relevant:** the docs (DEPLOYMENT.md/README.md quick-start) only describe a single
demo deployment per account, so this wasn't treated as blocking. If a future PR adds
multi-environment support (staging/prod in one account) or the docs start recommending
multiple deployments per account, this collision risk becomes load-bearing and should be
revisited (e.g. namespace the D1/KV names by repo/env).

Also noted (low confidence, not blocking): `scripts/setup.sh`'s `ask()` helper's `read -rp`
call (used for the custom-domain/cron/page-name prompts) has no EOF guard under
`set -euo pipefail`, unlike the standalone confirmation `read` later in the same file which
does have `|| true`. Ctrl-D at one of those three prompts aborts the whole script via
errexit instead of hitting the script's `die()` path. Minor UX issue, not a data-correctness
bug.

## Update — resolved in PR #22 (review pass 2)

Most of the above was fixed in the same PR; only the collision limitation remains open:

- **ask() EOF gap → FIXED.** `ask()`'s `read` now ends with `|| true`, so Ctrl-D falls
  back to the default instead of aborting via errexit.
- **D1/KV lookup swallow → FIXED.** `lookup_d1`/`lookup_kv` now capture only stdout and
  return non-zero on a failed `wr` call, so the caller aborts with an auth hint instead
  of masking the failure and taking the wrong create branch.
- **D1/KV name-collision (account-wide match) → STILL OPEN (accepted).** Unchanged; the
  single-deployment-per-account assumption still holds. Revisit if multi-env support lands.
