---
name: i18n-feature-2026-07
description: Findings from reviewing the amondnet/i18n branch (English + CJK i18n for the Astro status page) for silent failures
metadata:
  type: project
---

Reviewed `amondnet/i18n` vs `origin/main` (commit 384f788 "feat(i18n): add English + CJK internationalization") on 2026-07-07.

Architecture relevant to error-handling analysis:
- Locale for the actual rendered page is **hardcoded per file** in `apps/web/src/pages/{en,ja,ko,zh}/index.astro` (`<StatusPage locale="en" .../>`), NOT derived from `getLocale()`. So `getLocale()` in `apps/web/src/lib/data.ts` only affects the `/` → `/xx/` redirect target in `apps/web/src/middleware.ts`, not actual page content. This caps the blast radius of a `getLocale()` misfire to "wrong redirect language," not corrupted page content.
- The cron Worker (`apps/worker/src/index.ts` `loadConfig`) parses the same `config` KV document via `parseConfig()` with **no try/catch** — a malformed config throws uncaught there. So malformed config already has a loud, independent failure signal (Cloudflare Worker exception) elsewhere in the system. This is relevant context when judging the severity of the web-side silent fallback — it's a redundant/quieter failure path, not the only signal.
- `packages/core/src/config.ts` theme schema validates `locale` via `z.enum(LOCALES)`, so once `parseConfig()` succeeds, `theme.locale` is already a valid `Locale` — the `resolveLocale(parseConfig(raw).theme.locale)` wrapping in `getLocale()` is redundant defensive coding, not masking anything.

Key finding: `apps/web/src/lib/data.ts` `getLocale()` (lines 80-94) catches `parseConfig()` failure and falls back to `DEFAULT_LOCALE` with **zero logging** — just a comment. This breaks from the repo's own `console.error`/`console.warn` convention (see [[project-error-conventions]]). Recommended fix: add `console.warn('getLocale: malformed config, falling back to default locale', err)` in the catch.

Lower-confidence/minor findings also raised: `formatDay` (packages/core/src/i18n.ts) and pre-existing `relativeTime` (packages/core/src/incidents.ts) both silently return the raw unparsed string on bad input, with no logging — but both are tested/documented, low-blast-radius (display-only), and operate on internally-generated data that "should never" be malformed, so kept low severity.
