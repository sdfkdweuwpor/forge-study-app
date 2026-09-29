/** Factory defaults (PLAN §3.2). Factories return fresh objects so callers can never share arrays. */
import type { Millis, Settings, SettingsData } from './types'

export const SETTINGS_ID = 'app'

/** Brief §5.8 default blocklist. The blocker feature seeds `blocklist` rows from this. */
export const DEFAULT_BLOCKED_DOMAINS = [
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'x.com',
  'twitter.com',
  'reddit.com',
  'facebook.com',
  'snapchat.com',
  'netflix.com',
  'twitch.tv',
  'pinterest.com',
] as const

export const DEFAULT_MOTIVATION = [
  'The degree is built one 25-minute block at a time.',
  'Future you is counting on the next pomodoro, not the next scroll.',
  'Boredom is the doorway to deep work. Walk through it.',
  'You already decided what matters today. Keep the promise.',
  'Close the tab. Finish the unit. Then rest for real.',
] as const

export function defaultSettingsData(): SettingsData {
  return {
    profile: { name: '' },
    onboardedAt: null,
    appearance: { theme: 'system', accent: 'blue', reducedMotion: 'system' },
    weekStartsOn: 1,
    timer: {
      pomodoroMin: 25,
      shortBreakMin: 5,
      longBreakMin: 15,
      longBreakEvery: 4,
      customMin: 50,
      autoStartBreaks: false,
      autoStartFocus: false,
    },
    dailyGoalPomodoros: 6,
    sound: { enabled: true, volume: 0.6, chime: true, ambient: 'none', ambientVolume: 0.4 },
    notifications: { enabled: false, promptedAt: null },
    blocker: {
      mode: 'focus',
      schedule: [{ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }],
      motivation: [...DEFAULT_MOTIVATION],
      extensionIdOverride: null,
      lastSyncedAt: null,
      eventsCursor: 0,
    },
    scheduling: {
      globalDaysOff: [],
      defaultStudyStart: '09:00',
      bestHour: null,
      lastDailyRunDay: null,
    },
    backup: { lastExportAt: null, remindWeekly: true },
    tagColors: {},
    lastCelebratedLevel: 1,
    sync: { enabled: false, url: null, anonKey: null, lastSyncAt: null },
  }
}

export function defaultSettings(now: Millis): Settings {
  return { id: SETTINGS_ID, createdAt: now, updatedAt: now, ...defaultSettingsData() }
}
