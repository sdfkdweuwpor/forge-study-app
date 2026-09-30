/**
 * Device-local UI preferences (sidebar width, theme mirror, …) in localStorage.
 * Every access is wrapped in try/catch: storage can be blocked, full or absent (private windows, tests).
 * Anything that should follow the user between devices belongs in the `settings` row instead.
 */

export const PREF_KEYS = {
  /** Mirror of settings.appearance.theme; read synchronously by public/theme-init.js. */
  theme: 'forge:theme',
  /** Mirror of settings.appearance.accent (`data-accent`); read by public/theme-init.js. */
  accent: 'forge:accent',
  /** Mirror of settings.appearance.reducedMotion ('system' | 'on' | 'off'); read by public/theme-init.js. */
  reducedMotion: 'forge:reduced-motion',
  sidebarWidth: 'forge:sidebar:width',
  sidebarCollapsed: 'forge:sidebar:collapsed',
  /** Last Tasks layout (list | board | calendar); written by the tasks feature. */
  tasksLayout: 'forge:tasks:layout',
  /** Command palette recents: JSON array, newest first (src/app/palette/recents.ts). */
  paletteRecent: 'forge:palette:recent',
  /** Last Focus mode (pomodoro | custom | stopwatch); written by the focus feature. */
  focusMode: 'forge:focus:mode',
  /** Id of a session whose "Done with this task?" dialog has not been answered (survives a refresh). */
  focusPendingEnd: 'forge:focus:pending-end',
  /** A half-finished new-goal plan (JSON, see logic/plannerPersist.ts); written by the planner feature. */
  plannerDraft: 'forge:planner:draft',
  /** Goal ids whose course list is expanded in the sidebar (JSON array); written by the goals feature. */
  goalsNavOpen: 'forge:goals:nav-open',
  /** Today's list layout ('one' | 'grouped'); written by the today feature. */
  todayLayout: 'forge:today:layout',
  /** Roadmap zoom in months ('3' | '6' | '12'); written by the roadmap feature. */
  roadmapZoom: 'forge:roadmap:zoom',
  /** '1' makes the first-launch gate stand aside. Only read in builds with VITE_ENABLE_SEED (e2e, dev); written by e2e/fixtures.ts. */
  skipOnboarding: 'forge:onboarding:skip',
} as const

export type PrefKey = (typeof PREF_KEYS)[keyof typeof PREF_KEYS]

export function readPref(key: PrefKey): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * Calls `listener` after any preference is written or removed, in this tab or another (the `storage`
 * event), so a screen showing one can stay in step. Made for `useSyncExternalStore`. Returns the
 * unsubscribe function.
 */
export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) window.addEventListener('storage', notify)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', notify)
  }
}

export function writePref(key: PrefKey, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: the preference just does not persist */
    return
  }
  notify()
}

export function removePref(key: PrefKey): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* storage unavailable */
    return
  }
  notify()
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
