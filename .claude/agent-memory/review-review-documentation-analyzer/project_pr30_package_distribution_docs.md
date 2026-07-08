---
name: pr30-package-distribution-docs
description: PR #30 (package-based distribution, ADR-0002) documentation review outcome — DEPLOYMENT.md/README.md/ADRs verified accurate against packages/cli, packages/create-statusbeam, apps/web, apps/worker
metadata:
  type: project
---

Reviewed PR #30 "package-based distribution" (2026-07-08) — DEPLOYMENT.md rewrite, README.md
deploy section, docs/adr/0002 amendment, docs/adr/0001 note, and the create-statusbeam
templates/README.md, all cross-checked line-by-line against packages/cli/src/**,
packages/create-statusbeam/src/index.ts + templates/, and apps/web|worker/package.json +
astro.config.ts. Result: no CRITICAL/IMPORTANT findings — every documented command
(`bunx create-statusbeam`, `statusbeam setup|deploy|update`, flags `--skip-deploy`/`--yes`),
filename (`wrangler.worker.jsonc`/`wrangler.web.jsonc`), and described behavior (two separate
`@statusbeam/worker`+`@statusbeam/web` packages, worker build-free via wrangler bundling raw
TS from `node_modules/@statusbeam/worker/src/index.ts`, web ships source + builds per-user via
`STATUSBEAM_WRANGLER_CONFIG` consumed by `@astrojs/cloudflare`'s real `configPath` option,
verified present in node_modules/@astrojs/cloudflare v14.1.1) matched the implementation
exactly. ADR-0002 status flip to Accepted is consistent with what shipped.

**Why this is notable:** this diff is unusually well-aligned — the author (based on commit
style) clearly wrote docs and code in the same pass and cross-referenced them (e.g. code
comments in astro.config.ts and apply-config.ts explicitly explain the doc-relevant tradeoffs).
This is a good reference example of high documentation-implementation fidelity in this repo.

**One low-confidence, non-blocking item surfaced:** DEPLOYMENT.md and README.md both point to
an external `pleaseai/statusbeam-template` GitHub repo ("Use this template" button) — this
repo's existence/contents can't be verified from this local checkout (external resource, out
of diff scope). Worth a quick manual check before merge if that path matters, but not a
same-repo documentation/implementation mismatch.

**How to apply:** for future doc reviews of `packages/cli/**` or `packages/create-statusbeam/**`
changes in this repo, the fast verification path is: (1) diff DEPLOYMENT.md/README.md against
`packages/cli/src/cli.ts` HELP text + `src/commands/*.ts` for command/flag claims, (2) diff
against `packages/create-statusbeam/templates/*` for scaffolded filenames, (3) check
`apps/{web,worker}/package.json` `statusbeam` metadata block + `files` array for
publish-shape claims (build-free vs ships-source) referenced in docs/adr/0002.
