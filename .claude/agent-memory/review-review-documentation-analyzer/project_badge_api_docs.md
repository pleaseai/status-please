---
name: project-badge-api-docs
description: status-please "Badges & public API" README section verified accurate against implementation (2026-07-08)
metadata:
  type: project
---

Verified the `amondnet/badge` branch's new README "Badges & public API" section
(pleaseai/status-please repo) against the actual route implementations. Every
claim checked out — no doc/impl mismatches found.

Key facts about this codebase useful for future doc reviews here:

- Badge/status API routes live in `apps/web/src/pages/api/*` (Astro file-based
  routing): `badge.json.ts`, `badge/[slug].json.ts`, `badge/[slug]/uptime.json.ts`,
  `badge/[slug]/response-time.json.ts`, `status.json.ts`, `status/[slug].json.ts`.
- All six routes funnel through `apps/web/src/lib/api.ts`'s `jsonResponse()`,
  which unconditionally sets `Access-Control-Allow-Origin: *` — so CORS claims
  apply to badges too, not just the two status-API endpoints (README only
  explicitly claims it for the status API, which is a true subset, not wrong).
  `notFound()` also sets CORS the same way.
  `Cache-Tag` = `STATUS_PAGE_TAG` + per-site tags, defined in
  `packages/core/src/cache.ts`; purge-by-tag happens in
  `apps/worker/src/cache.ts` on real status changes (from `apps/worker/src/index.ts`).
  This confirms "badges never lag the page" and "purged on the same status
  changes" claims are accurate — badges share the exact purge path as the page.
- Badge colors: `packages/core/src/badge.ts` `severityColor()` switches on a
  `Severity` enum with 5 cases (operational/degraded/partial_outage/major_outage/
  maintenance), but `SiteSummary['status']` (`CheckStatus`) only has 3 values
  (up/degraded/down) — `toSeverity()` in `packages/core/src/types.ts` maps
  down→major_outage only, so partial_outage/orange and maintenance/blue are
  unreachable dead branches for badges today. README's simplified "green→
  operational, yellow→degraded, red→down" is accurate for what's reachable.
- `slug` in `status.config.yml` (packages/core/src/config.ts `siteSchema`) is
  a genuinely optional field defaulting to `slugify(name)` — README's claim
  "`slug` from status.config.yml, or the slugified name" is correct.
- The example badge URL `/api/badge/api/uptime.json` uses slug `api`,
  matching the `- name: API` entry in the README's own config example
  (slugify("API") → "api") — intentional, not a typo.
- GitHub-flavor markdown anchor for `## Badges & public API` is
  `#badges--public-api` (double hyphen, because `&` is stripped leaving two
  spaces before hyphenation) — the roadmap checkbox link to this anchor is
  correct.

See also [[status-please-project]] (user's global memory, other conversation)
for broader stack/roadmap context.
