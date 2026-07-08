---
name: dark-mode-theme-toggle-2026-07
description: Findings from reviewing the amondnet/dark-mode branch (ThemeToggle.tsx + StatusPage.astro anti-FOUC script) for silent failures
metadata:
  type: project
---

Reviewed `amondnet/dark-mode` vs `origin/main` on 2026-07-08 (`git diff origin/main...HEAD`).

Confirmed no React Error Boundary exists anywhere in `apps/web/src` (grep returned zero matches).
`ThemeToggle` hydrates via `client:load` as its own Astro island root, separate from `StatusList`'s
`client:visible` island — a crash in one island does not affect the other or the static SSR shell.

## Key finding

`apps/web/src/components/StatusPage.astro:49-54` wraps `localStorage.getItem('theme')` in an
intentional empty `try/catch` for the anti-FOUC head script — correct-by-design, since this is a
blocking pre-paint script and the only failure mode is a cosmetic flash of system-default theme.
This is NOT a bug (see [[status_please_conventions]] for the repo's general "acceptable silent
degrade" precedents in badge.ts).

However `apps/web/src/components/ThemeToggle.tsx` does the *same* `localStorage` access
(`readStoredTheme()` at line 33-35, called from a mount `useEffect` at line 50-52) and a write
(`applyTheme()` at line 20-31, called from the click handler `cycle()` at line 54-58) with **no
try/catch at all**, despite a comment in the file explicitly acknowledging it should stay "in sync"
with the astro script's storage contract.

Consequences if `localStorage` throws (Safari private-mode/legacy WebKit, storage disabled via
policy/extension, partitioned third-party iframe storage):
- Mount effect (`readStoredTheme`): an uncaught throw inside `useEffect` is caught by React's
  commit-phase error handling; with no Error Boundary present, React unmounts the whole
  `ThemeToggle` island — the button silently disappears after first paint, console-only signal.
- Click handler (`applyTheme` → `cycle`): `classList.toggle` runs before the `localStorage.setItem`
  call, so the visible theme changes but persistence silently fails, and since the throw prevents
  `setTheme(next)` from running, the button's icon goes out of sync with the actual `.dark`/`.light`
  class until the next successful click. On reload the choice reverts with no indication to the user.

Recommended fix (given to the user): wrap both `readStoredTheme()` and the storage calls inside
`applyTheme()` in try/catch, mirroring the astro script, and keep the DOM class change even if
persistence fails (session-only theme is an acceptable degrade; total silence about the failure
mode is not).

Confidence: 82 (mount-effect case, IMPORTANT) and 78 (click-handler case, borderline
IMPORTANT/MINOR) — not "definitely happens" since modern mainstream browsers rarely throw here,
but a real and previously-acknowledged-by-the-author risk class.
