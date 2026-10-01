import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSettings } from '@/db/hooks/useSettings'
import type { AccentId, ReducedMotionPref, Settings } from '@/db/types'
import { PREF_KEYS, readPref, writePref } from '@/lib/localPrefs'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { recordError } from '../reportError'
import { resolveReducedMotion, resolveTheme, setTheme } from './themeActions'

type Theme = Settings['appearance']['theme']

export interface ThemeApi {
  /** The user's choice. */
  theme: Theme
  /** What is actually showing. */
  resolvedTheme: 'light' | 'dark'
  accent: AccentId
  reducedMotion: boolean
  /**
   * Saves the choice and applies it. Resolves false when the database refused the write: the choice
   * then still applies on this device (mirrored to localStorage) but will not sync or survive a cleared browser.
   */
  setTheme(theme: Theme): Promise<boolean>
}

const ThemeContext = createContext<ThemeApi | null>(null)

const ACCENTS: readonly AccentId[] = ['blue', 'teal', 'green', 'orange', 'pink', 'graphite']

function storedTheme(): Theme {
  const v = readPref(PREF_KEYS.theme)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

function storedAccent(): AccentId {
  const v = readPref(PREF_KEYS.accent)
  return ACCENTS.find((a) => a === v) ?? 'blue'
}

function storedReducedMotion(): ReducedMotionPref {
  const v = readPref(PREF_KEYS.reducedMotion)
  return v === 'on' || v === 'off' || v === 'system' ? v : 'system'
}

/** Keeps the browser chrome (address bar, status bar) in step with the app's background, whatever the OS scheme says. */
function syncThemeColorMeta(): void {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  if (!bg) return
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', bg)
  }
}

/**
 * Applies `data-theme`, `data-accent` and `data-reduced-motion` on <html> from settings, and mirrors
 * all three choices to localStorage so public/theme-init.js can avoid a flash on the next load.
 * Until settings load, the stored mirrors are used, so nothing changes under the user's eyes.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const settings = useSettings()
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const systemReduce = useMediaQuery('(prefers-reduced-motion: reduce)')
  // Set only when saving the theme to the database failed; wins over the (unchanged) stored setting.
  const [unsavedTheme, setUnsavedTheme] = useState<Theme | null>(null)

  const theme: Theme = unsavedTheme ?? settings?.appearance.theme ?? storedTheme()
  const accent: AccentId = settings?.appearance.accent ?? storedAccent()
  const reducedPref: ReducedMotionPref = settings?.appearance.reducedMotion ?? storedReducedMotion()
  const reduced = resolveReducedMotion(reducedPref, systemReduce)
  const resolvedTheme = resolveTheme(theme, systemDark)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
    syncThemeColorMeta()
  }, [resolvedTheme])

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent)
  }, [accent])

  useEffect(() => {
    document.documentElement.setAttribute('data-reduced-motion', reduced ? 'on' : 'off')
  }, [reduced])

  const loaded = settings !== undefined
  useEffect(() => {
    if (!loaded) return
    writePref(PREF_KEYS.theme, theme)
    writePref(PREF_KEYS.accent, accent)
    writePref(PREF_KEYS.reducedMotion, reducedPref)
  }, [loaded, theme, accent, reducedPref])

  const value = useMemo<ThemeApi>(
    () => ({
      theme,
      resolvedTheme,
      accent,
      reducedMotion: reduced,
      setTheme: async (t) => {
        try {
          await setTheme(t)
          setUnsavedTheme(null)
          return true
        } catch (e) {
          recordError(e, 'setTheme')
          writePref(PREF_KEYS.theme, t)
          setUnsavedTheme(t)
          return false
        }
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
