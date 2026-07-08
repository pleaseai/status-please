# Memory Index

- [status-please conventions](status_please_conventions.md) — repo's logging style (plain console.error, no Sentry/errorIds) + known intentional fail-open fallbacks in badge.ts
- [Project error-handling conventions](project_error_conventions.md) — no Sentry/logError infra; console.error/warn is house style (see apps/worker/src/cache.ts, notify.ts)
- [i18n feature review 2026-07](i18n_feature_2026_07.md) — amondnet/i18n branch findings: getLocale() silent catch, locale-per-URL architecture, cron Worker's redundant loud config-parse failure
- [dark-mode theme toggle 2026-07](dark_mode_theme_toggle_2026_07.md) — amondnet/dark-mode: astro anti-FOUC empty catch is fine by design; ThemeToggle.tsx's own unguarded localStorage calls are the real gap, no ErrorBoundary in app
- [setup scripts error handling (PR #22)](setup_scripts_error_handling.md) — D1/KV lookup swallow + apply-config.ts setNetworking/setCron fallbacks — all fixed in PR #22 (lookups return non-zero on wr failure; setNetworking/setCron now throw)
