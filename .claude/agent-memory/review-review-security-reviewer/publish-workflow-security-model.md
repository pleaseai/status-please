---
name: publish-workflow-security-model
description: How .github/workflows/publish.yml scopes secrets and least-privilege permissions
metadata:
  type: project
---

`.github/workflows/publish.yml` publishes one npm package per release with provenance.

**Why:** Org standard requires SHA-pinned actions + `npm publish --provenance` (OIDC), see [[injection-avoidance-conventions]].

**How to apply:**
- Top-level `permissions:` are least-privilege: `contents: read` + `id-token: write` (id-token needed for provenance OIDC). Do not flag as over-privileged.
- `NPM_TOKEN` is exposed ONLY in the final "Pack + publish" step's `env:` (`NODE_AUTH_TOKEN`), NOT during `bun install`/`bun run build` — token isolation is intentional.
- `environment: npm` (and `production` in the scaffolded `deploy.yml`) is where token/secret protection rules are expected to be configured in repo settings — the workflow comments say so. A compromised-maintainer release is mitigated at the environment-protection layer, not in YAML.
- All third-party actions are full-SHA pinned (checkout, setup-bun, setup-node, jdx/mise-action). Verified clean as of PR #30.
- Minor open item (LOW): `bun-version: latest` in publish.yml is an unpinned *tool* version (actions themselves are pinned) — reproducibility nit, not a vuln.
