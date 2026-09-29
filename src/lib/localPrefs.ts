/**
 * Device-local UI preferences (sidebar width, theme mirror, …) in localStorage.
 * Every access is wrapped in try/catch: storage can be blocked, full or absent (private windows, tests).
 * Anything that should follow the user between devices belongs in the `settings` row instead.
 */

export const PREF_KEYS = {
  /** Mirror of settings.appearance.theme; read synchronously by public/theme-init.js. */
  theme: 'forge:theme',
  sidebarWidth: 'forge:sidebar:width',
  sidebarCollapsed: 'forge:sidebar:collapsed',
  /** Last Tasks layout (list | board | calendar); written by the tasks feature. */
  tasksLayout: 'forge:tasks:layout',
} as const

export type PrefKey = (typeof PREF_KEYS)[keyof typeof PREF_KEYS]

export function readPref(key: PrefKey): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writePref(key: PrefKey, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: the preference just does not persist */
  }
}

export function removePref(key: PrefKey): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* storage unavailable */
  }
}

export function readNumberPref(key: PrefKey, fallback: number, min: number, max: number): number {
  const raw = readPref(key)
  if (raw === null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export function readBoolPref(key: PrefKey, fallback: boolean): boolean {
  const raw = readPref(key)
  return raw === null ? fallback : raw === '1'
}

export function writeBoolPref(key: PrefKey, value: boolean): void {
  writePref(key, value ? '1' : '0')
}
