---
name: injection-avoidance-conventions
description: Deliberate injection-avoidance patterns in the statusbeam CLI and workflows — do not re-flag these as vulnerabilities
metadata:
  type: project
---

The statusbeam CLI and CI workflows use several deliberate, load-bearing patterns to avoid injection. Treat these as intended design, not defects.

**Why:** This is a pleaseai OSS repo publishing packages + spawning wrangler/astro/git with user-supplied values (domain, cron, page name, db name, release tag). The authors hardened each sink on purpose.

**How to apply — do not re-flag:**
- `packages/cli/src/lib/run.ts` — `spawn`/`spawnSync` are always called WITHOUT `shell:true`, and every user value goes as an argv element, never interpolated into a shell string. No command injection.
- `packages/cli/src/lib/apply-config.ts` — every splice of an external value into JSONC uses a **replacer function** (`() => value`), never a replacement string, so a `$`/`$&`/`$1` in the value can't be misread as a regex special. `esc()` escapes regex metachars. Intentional.
- Values written into JSONC/YAML go through `JSON.stringify` to produce a safely-quoted scalar (domain, cron, page name). Intentional.
- `.github/workflows/publish.yml` — the release tag reaches the shell only via an `env: TAG:` var used in **quoted** parameter expansions (`"${TAG%-v*}"`), and maps through a `case` to 5 fixed dirs (else `exit 1`). Not injectable, not path-traversable.
- Committed Slack webhook in `templates/status.config.yml` is a placeholder (`T00000000/B00000000/XXXX…`), not a real secret — confirmed.
