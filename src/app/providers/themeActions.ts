import { getSettings, updateSettings } from '@/db/repos/settings'
import type { Settings } from '@/db/types'

type Theme = Settings['appearance']['theme']
type ReducedMotion = Settings['appearance']['reducedMotion']

export function resolveTheme(theme: Theme, systemDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}

export function resolveReducedMotion(pref: ReducedMotion, systemReduce: boolean): boolean {
  return pref === 'system' ? systemReduce : pref === 'on'
}

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export async function setTheme(theme: Theme): Promise<void> {
  await updateSettings({ appearance: { theme } })
}

/** Flip between the light and dark that is currently showing (an explicit choice replaces `system`). */
export async function toggleTheme(): Promise<void> {
  const { appearance } = await getSettings()
  const next = resolveTheme(appearance.theme, prefersDark()) === 'dark' ? 'light' : 'dark'
  await setTheme(next)
}

export async function toggleReducedMotion(): Promise<void> {
  const { appearance } = await getSettings()
  const reduced = resolveReducedMotion(appearance.reducedMotion, prefersReducedMotion())
  await updateSettings({ appearance: { reducedMotion: reduced ? 'off' : 'on' } })
}
