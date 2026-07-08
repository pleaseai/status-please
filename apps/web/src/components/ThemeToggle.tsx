import type { Locale } from '@status-please/core'
import { getDict } from '@status-please/core'
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
const ICON: Record<Theme, typeof Sun> = { system: Monitor, light: Sun, dark: Moon }

/** Apply a theme to <html> and persist it. Mirrors the inline script's logic. */
function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('light', theme === 'light')
  root.classList.toggle('dark', theme === 'dark')
  if (theme === 'system') {
    localStorage.removeItem(THEME_STORAGE_KEY)
  }
  else {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  }
}

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
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
    setTheme(readStoredTheme())
  }, [])

  const cycle = (): void => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? 'system'
    applyTheme(next)
    setTheme(next)
  }

  const Icon = ICON[theme]
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
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  )
}
