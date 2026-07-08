---
name: pr30-cli-package-distribution-review
description: Findings from reviewing PR #30 (ADR-0002 package-based distribution — packages/cli, packages/create-statusbeam, astro.config configPath) — verified clean via execution, not just reading
metadata:
  type: project
---

PR #30 introduced `@statusbeam/cli` (`statusbeam` bin: setup/deploy/update),
`create-statusbeam` (scaffolder), and switched `apps/web/astro.config.ts` to read
`STATUSBEAM_WRANGLER_CONFIG` into the `@astrojs/cloudflare` adapter's `configPath`
option. `packages/cli/src/lib/apply-config.ts` is a deliberate port of
`scripts/apply-config.ts` (see [[pr22-setup-script-review]] for the original's
verified wrangler-JSON-shape assumptions, which still hold — unchanged in the port).

**Review method:** not just static reading — actually ran `bun install
--frozen-lockfile` (passed, confirms bun.lock matches the new manifests), typechecked
`packages/cli` and `packages/create-statusbeam` with `tsc --noEmit` (clean), ran the
real `bun build` scripts for core/cli/create-statusbeam (all bundle cleanly), executed
the built `create-statusbeam` scaffolder end-to-end against a temp dir (gitignore
rename, name injection with a name containing `:`/`,`, package.json generation, git
init, non-empty-dir guard with/without `--yes` all verified correct), executed the
built `statusbeam` CLI's arg parsing (`--help`, `--version`, unknown command/flag →
clean `die()` exit 1), and ran `apply-config.ts`'s `injectIds`/`setCron`/`setNetworking`
against the real scaffolded `wrangler.worker.jsonc`/`wrangler.web.jsonc` templates for
two successive runs (first-run "shipped comment" path, then marker-based idempotent
re-run changing cron and clearing the custom domain) — both outputs parse as valid
JSON after comment-stripping.

**Result: no critical or important issues found.** Only very low-confidence nitpicks
(not worth blocking): `cli.ts`'s `--cwd` flag silently swallows a following flag-like
token as its value if the user omits the directory (e.g. `--cwd --yes`); trailing
positional args after the command are silently dropped rather than erroring;
`create-statusbeam`'s `toPackageName()` strips leading/trailing `-`/`.` but not a
leading `_`, which npm package names also disallow (only reachable if the target
directory's basename starts with `_`).

**Why relevant for future PRs touching these files:** the resolution chain
(`resolvePackage`/`resolveBin` in `packages/cli/src/lib/project.ts`, using
`createRequire` from `@statusbeam/web`'s own install location to find `wrangler`/
`astro` bins) was confirmed to actually work end-to-end in this monorepo's workspace
layout, not just plausible-looking. If `apps/web/package.json`'s `wrangler`/`astro`
deps ever move back to `devDependencies` or get hoisted differently, re-verify this
resolution chain — it depends on `wrangler`/`astro` being real (non-dev) dependencies
of `@statusbeam/web` so they're present wherever `@statusbeam/web` is installed as a
dependency of a user's thin project.
