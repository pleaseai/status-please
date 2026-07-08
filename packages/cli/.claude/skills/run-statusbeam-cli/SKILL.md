---
name: run-statusbeam-cli
description: Build, run, and drive the statusbeam CLI (packages/cli). Use when asked to run, start, build, smoke-test, or exercise the statusbeam command-line tool, check its exit codes, or drive its setup/deploy/update commands.
---

`packages/cli` is `@statusbeam/cli` — the `statusbeam` command-line tool that
provisions, configures, and deploys a StatusBeam status page to Cloudflare. It's
a small dependency-free-arg-parsing Node CLI (`setup` / `deploy` / `update`,
plus `--help`/`--version`). Drive it with the committed smoke script:
`.claude/skills/run-statusbeam-cli/smoke.sh` — it builds the binary, runs it
through every offline arg/error/prerequisite path, direct-invokes the internal
pure functions, and runs the unit tests. No Cloudflare account or network needed.

All paths below are relative to `packages/cli/`.

## Prerequisites

Only the repo toolchain — no system packages. `bun` and `node` (both pinned in
the root `mise.toml`: node 24, bun latest). Workspace deps must be installed
(`bun install` from the repo root; they already are in a checked-out repo — the
CLI resolves `wrangler`/`astro` from the sibling `@statusbeam/web` package).

```bash
bun --version   # 1.3.14 here
node --version  # v24.x
```

## Build

```bash
bun run build   # bun build src/cli.ts → dist/cli.js (ESM, node target, +shebang)
```

Produces an executable `dist/cli.js` (`#!/usr/bin/env node`). Runnable as
`node dist/cli.js …` or `./dist/cli.js …`.

## Run (agent path) — the smoke driver

This is the primary way to drive the CLI. From `packages/cli/`:

```bash
.claude/skills/run-statusbeam-cli/smoke.sh            # build + drive + direct-invoke + test
.claude/skills/run-statusbeam-cli/smoke.sh --no-build # skip build (binary already built)
```

Exit 0 = every assertion passed; non-zero = first failure (with its output).
The driver covers three layers:

1. **The built binary** — `--version`, `--help`, no-args→help, and the error
   paths (`unknown command`, `unknown option`, `--cwd` missing value) with their
   expected exit codes; plus the `setup`/`deploy` **prerequisite gates** against
   an unscaffolded dir (they die with a clear "scaffold a project first" message,
   no crash).
2. **Direct invocation** of the internal pure functions most PRs touch —
   `detectPackageManager` / `upgradeArgs` (src/commands/update.ts), `injectIds` /
   `normalizeDomain` (src/lib/apply-config.ts) — imported straight from TS source.
3. **The unit test suite** (`bun test`, 28 tests).

Expected tail:

```
▸ Summary: 10 passed, 0 failed
```

### Drive individual commands by hand

```bash
node dist/cli.js --version          # → 0.0.0 (see Gotchas), exit 0
node dist/cli.js --help             # usage + command list, exit 0
node dist/cli.js frobnicate         # ✗ unknown command …, exit 1
node dist/cli.js setup --cwd /tmp/x --yes   # ✗ missing wrangler.worker.jsonc, exit 1
```

### Direct-invoke a single internal function

The layer most PRs touch — no build, no full dispatch, no network:

```bash
NODE_ENV=test bun -e "import('./src/commands/update.ts').then(m => console.log(m.upgradeArgs('yarn', true)))"
# → [ "up", "@statusbeam/cli", "@statusbeam/core", "@statusbeam/worker", "@statusbeam/web" ]
```

## Run (human path)

`bun run build && ./dist/cli.js setup` in a *scaffolded* StatusBeam project
(one made by `bunx create-statusbeam`, holding `status.config.yml` +
`wrangler.worker.jsonc` + `wrangler.web.jsonc`). It is interactive and, past the
prerequisite/auth gates, makes real Cloudflare API calls — not runnable to
completion in a headless container without a scaffolded project and
`wrangler login` / `CLOUDFLARE_API_TOKEN`.

## Test

```bash
bun test   # 28 pass, 0 fail — from packages/cli/
```

## Gotchas

- **`--version` prints `0.0.0` in-repo.** The bundle reads `../package.json`
  relative to itself, and `packages/cli/package.json` is `0.0.0` (unreleased in
  the monorepo). Not a bug — it reflects the real version only in a published
  install.
- **`setup`/`deploy` are gated twice before doing anything.** First a file-
  existence check (needs `status.config.yml` + both `wrangler.*.jsonc`), then a
  Cloudflare auth check (`wrangler whoami`). Both surface as `die()` → exit 1
  with a clear message. That's why the driver can exercise the command layer
  fully offline: it only reaches the gates, never real Cloudflare calls.
- **Don't drive `update` end-to-end to "smoke" it.** It shells out to the
  detected package manager (`bun/pnpm/yarn/npm update @statusbeam/*`), which hits
  the registry and rewrites the lockfile. Test its logic via direct invocation
  (`detectPackageManager` / `upgradeArgs` / `isYarnBerry`) instead — the driver
  does exactly this.
- **`wrangler`/`astro` are resolved from `@statusbeam/web`, not globally.** The
  CLI (`src/lib/project.ts`) resolves those bins from the installed web package's
  own context, so a global wrangler is irrelevant and the workspace must be
  installed for `deploy` to find them.

## Troubleshooting

- **`dist/cli.js not found`** — run `bun run build` first (or run the driver
  without `--no-build`).
- **`Cannot find module '@statusbeam/web/package.json'`** from `setup`/`deploy`
  past the file gate — workspace deps aren't installed; run `bun install` at the
  repo root.
- **Direct-invoke import errors** — imports must use an absolute path to
  `src/*.ts` (the driver writes the helper with `$CLI_DIR` baked in); a bare
  relative path resolves against the script's own location, not `packages/cli/`.
