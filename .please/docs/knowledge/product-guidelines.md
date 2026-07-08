# Product Guidelines — StatusBeam

## Audience & voice

- **Audience**: developers and operators evaluating or running a status page.
- **Voice**: direct, technical, honest about trade-offs. The README's tone is the
  reference — state what a feature does and, where relevant, what it *fixes*
  versus upptime. No marketing fluff.
- **Language**: this is a public open-source repo under the `pleaseai` org — all
  docs, code comments, identifiers, and commit messages are **English only**.

## Documentation

- README is the front door: value proposition, live demo link, "How it works"
  architecture diagram, roadmap with shipped vs. planned checkboxes.
- Feature-specific guides live under `docs/` (e.g. `docs/adapters/statuspage.md`).
- Deployment lives in `DEPLOYMENT.md`; contribution rules in `CONTRIBUTING.md`;
  security policy in `SECURITY.md`.
- Prefer runnable examples and copy-pasteable config over prose.

## UX & design system

- **Frontend**: Astro + React islands, shadcn/ui component set, Tailwind CSS v4.
- **Severity token system** — status colors (up / degraded / down) are driven by
  design tokens, not ad-hoc hex values. Reuse the tokens; do not hardcode colors.
- **Charts**: recharts for response-time graphs; the 90-day uptime bar is an
  adaptive custom timeline.
- **Accessibility**: status must never be conveyed by color alone — pair every
  severity color with a label/icon (WCAG 2.1 AA).
- **Performance**: the page is edge-rendered and cached by `Cache-Tag`; keep
  client JS minimal (Astro islands only where interactivity is required).

## Configuration UX

- One `status.config.yml` is the single source of truth for an instance;
  `status.config.example.yml` documents every field.
- Config is validated with Zod schemas in `@statusbeam/core` — schema errors
  should be actionable and point at the offending field.

## Engineering conventions

- Follow the org engineering standards (file ≤500 LOC, YAGNI, DRY, tests).
- Code style via `@pleaseai/eslint-config`; format/lint before commit.
- Conventional Commits (release-please drives versioning + CHANGELOG).
- SHA-pinned GitHub Actions; npm provenance for any published package.
