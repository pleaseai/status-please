---
name: cli-scaffolder-error-handling-pr30
description: Error-handling shape of packages/cli/src/** and packages/create-statusbeam/src/index.ts (PR #30) — TS port of scripts/setup.sh/apply-config.ts; what carried forward from PR #22's fixes and what's new
metadata:
  type: project
---

PR #30 ports `scripts/setup.sh` + `scripts/apply-config.ts` into a proper CLI
(`@statusbeam/cli`, `packages/cli/src/**`) and a scaffolder
(`create-statusbeam`, `packages/create-statusbeam/src/index.ts`) that write
into the *user's own* wrangler configs instead of the monorepo's. See
[[setup_scripts_error_handling]] for the original scripts' history (PR #22
fixed the D1/KV lookup swallow and the setNetworking/setCron warn-only
fallbacks).

## What carried forward correctly from PR #22

- `lib/wrangler.ts` `lookupD1`/`lookupKv` (lines ~32-42, ~49-60): `capture()`
  called *without* `allowFailure`, so a non-zero wrangler exit throws instead
  of being misread as "not found" — the core PR #22 fix is intact in the new
  code.
- `lib/apply-config.ts` `setNetworking`/`setCron`: both still `throw` on an
  unrecognized config shape (no warn-only silent fallback regression).
- `allowFailure` is used in exactly one place, `isAuthenticated` in
  `wrangler.ts`, and both call sites (`commands/setup.ts`,
  `commands/deploy.ts`) turn a `false` result into a loud `die()`. Appropriate
  use, not swallowing.
- Every step of `commands/deploy.ts` (`applySchema`, `uploadConfig`,
  `deployWorker`, `astro build`, `wrangler deploy`) runs through
  `run()`/`capture()` without `allowFailure` — an uncaught throw propagates
  to `main().catch` → `die()` → exit 1. No silent continuation anywhere in
  the deploy pipeline.

## New gap introduced by the port: `injectIds` (apply-config.ts:21-33)

Docstring claims it "also updates a previously injected value when a
placeholder is no longer present (id changed)" — the implementation does
**not** do this; it's a bare `replaceAll(PLACEHOLDER, ...)` that no-ops if
the placeholder string isn't present (i.e. the file already has a real id
from a prior run). If the underlying D1/KV resource is ever deleted +
recreated (new id) while the wrangler config still has the old real id
embedded, `setup.ts`'s re-run silently keeps the stale id — `setCron`/
`setNetworking` still succeed on their own anchors, so `edit()` writes the
file and `setup.ts` prints a green "configured" line while the id is stale.
No `console.warn` anywhere in `injectIds` for this case. Reported at
confidence 80 / IMPORTANT in the PR #30 review pass.

**How to apply:** if `apply-config.ts` is touched again, check whether
`injectIds` was fixed to actually replace a stale (non-placeholder) id, or
at minimum whether it now warns when `d1`/`kv` is passed but no placeholder
was found — matching the throw-loudly precedent `setNetworking`/`setCron`
already set in the same file.

## Minor/low-confidence notes from the same pass (not re-verify unless touched)

- `lookupD1`/`lookupKv`: `if (!res.stdout.trim()) return undefined` treats
  exit-0-with-empty-stdout the same as "not found" — narrower residual
  version of the old bug, since a real empty list prints `"[]"` not empty.
  Confidence 45.
- `readJsoncString` (apply-config.ts:114-118) takes the first regex match of
  a key file-wide; safe today (each queried key appears once in the shipped
  templates) but would silently pick the wrong occurrence if a template ever
  adds a second `d1_databases` binding or an `env.*` override block.
- `create-statusbeam/src/index.ts:108` page-name injection is a bare
  `config.replace(/^name:.*$/m, ...)` with no success check — correct against
  the current template (`status.config.yml:4`) but would silently drop the
  user's typed name if the template's `name:` line ever changes shape.
- `cli.ts`/`create-statusbeam/index.ts` version() fallback to `'0.0.0'` on
  package.json read failure is unlogged (low impact, bundled file essentially
  never fails to read).
