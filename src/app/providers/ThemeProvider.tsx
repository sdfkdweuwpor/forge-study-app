import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useSettings } from '@/db/hooks/useSettings'
import type { AccentId, Settings } from '@/db/types'
import { PREF_KEYS, readPref, writePref } from '@/lib/localPrefs'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { resolveReducedMotion, resolveTheme, setTheme } from './themeActions'

type Theme = Settings['appearance']['theme']

export interface ThemeApi {
  /** The user's choice. */
  theme: Theme
  /** What is actually showing. */
  resolvedTheme: 'light' | 'dark'
  accent: AccentId
  reducedMotion: boolean
  setTheme(theme: Theme): void
}

const ThemeContext = createContext<ThemeApi | null>(null)

function storedTheme(): Theme {
  const v = readPref(PREF_KEYS.theme)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

/**
 * Applies `data-theme`, `data-accent` and `data-reduced-motion` on <html> from settings, and mirrors
 * the theme choice to localStorage so public/theme-init.js can avoid a flash on the next load.
 * Until settings load, the stored mirror is used, so nothing changes under the user's eyes.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const settings = useSettings()
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const systemReduce = useMediaQuery('(prefers-reduced-motion: reduce)')

  const theme: Theme = settings?.appearance.theme ?? storedTheme()
  const accent: AccentId = settings?.appearance.accent ?? 'blue'
  const reduced = resolveReducedMotion(settings?.appearance.reducedMotion ?? 'system', systemReduce)
  const resolvedTheme = resolveTheme(theme, systemDark)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent)
  }, [accent])

  useEffect(() => {
    document.documentElement.setAttribute('data-reduced-motion', reduced ? 'on' : 'off')
  }, [reduced])

  const loaded = settings !== undefined
  useEffect(() => {
    if (loaded) writePref(PREF_KEYS.theme, theme)
  }, [loaded, theme])

  const value = useMemo<ThemeApi>(
    () => ({
      theme,
      resolvedTheme,
      accent,
      reducedMotion: reduced,
      setTheme: (t) => {
        void setTheme(t)
      },
    }),
    [theme, resolvedTheme, accent, reduced],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
