import type { Locale } from '@statusbeam/core'
import { getDict } from '@statusbeam/core'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The three theme choices. `system` follows the OS via the root's
 * `color-scheme: light dark`; `light`/`dark` force it by toggling the matching
 * class on <html> (see the `@custom-variant dark` + `.dark`/`.light` blocks in
 * global.css). Persisted under this key and read back by the inline
 * anti-FOUC script in StatusPage.astro — keep both in sync.
 */
export type Theme = 'light' | 'dark' | 'system'
export const THEME_STORAGE_KEY = 'theme'

const ORDER: readonly Theme[] = ['system', 'light', 'dark']

/**
 * Apply a theme to <html> and persist it. Mirrors the inline script's logic.
 * `localStorage` access is guarded because a restrictive environment (Safari
 * "Block All Cookies", sandboxed iframe, enterprise policy) throws a
 * SecurityError on any access — the class toggle stays outside the guard so the
 * visual theme still flips even when persistence is unavailable.
 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('light', theme === 'light')
  root.classList.toggle('dark', theme === 'dark')
  try {
    if (theme === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY)
    }
    else {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    }
  }
  catch {
    // Persistence unavailable — the in-page toggle still works for this visit.
  }
}

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  }
  catch {
    return 'system'
  }
}

/**
 * Cycles system → light → dark → system, forcing the color scheme by toggling
 * the `.light`/`.dark` class on <html>. Hydrates as a React island; the inline
 * script in the page head applies the stored choice before paint, so this only
 * syncs the button's display and handles clicks.
 */
export function ThemeToggle({ locale }: Readonly<{ locale: Locale }>) {
  const t = getDict(locale)
  // Start from `system` for a stable SSR/first-paint markup, then reconcile with
  // the persisted choice on mount to avoid a hydration mismatch.
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    // Re-apply to <html> too, not just state: normally the anti-FOUC inline
    // script already set the class, but if it was suppressed (strict CSP with no
    // 'unsafe-inline', an extension) the island still hydrates — so applyTheme
    // here keeps the DOM class, icon, and label in sync regardless.
    const stored = readStoredTheme()
    applyTheme(stored)
    setTheme(stored)
  }, [])

  const cycle = (): void => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? 'system'
    applyTheme(next)
    setTheme(next)
  }

  const label = `${t.a11y.themeToggle}: ${t.theme[theme]}`

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md border border-border',
        'text-muted-foreground transition-colors',
        'hover:bg-muted hover:text-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
      )}
    >
      {/*
        Which icon shows is driven by the `.light`/`.dark` class the inline
        script sets on <html> before first paint, not by React state — so a
        returning visitor with a forced theme sees the correct icon immediately,
        with no post-hydration flash. `system` = neither class → Monitor. The
        aria-label still comes from state (reconciled in the mount effect); a
        label that settles a tick after paint is invisible and pre-interaction.
      */}
      <Monitor className="size-4 dark:hidden light:hidden" aria-hidden="true" />
      <Sun className="hidden size-4 light:block" aria-hidden="true" />
      <Moon className="hidden size-4 dark:block" aria-hidden="true" />
    </button>
  )
}
