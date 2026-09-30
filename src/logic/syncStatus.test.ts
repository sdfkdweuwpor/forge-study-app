import { describe, expect, it } from 'vitest'
import type { SyncError } from '@/db/types'
import { SYNC_TEXT } from './syncApply'
import {
  CLOCK_WARNING_MS,
  FORBIDDEN_TEXT,
  OFFLINE_TEXT,
  PAUSED_TEXT,
  SIGNED_OUT_TEXT,
  UPDATE_NEEDED_TEXT,
  SETUP_TEXT,
  clockWarning,
  describeSync,
  formatAgo,
  formatWait,
  progressText,
  sectionState,
  type SectionInput,
  type SyncStatusInput,
} from './syncStatus'

const NOW = 1_790_000_000_000
const MIN = 60_000

const base: SyncStatusInput = {
  now: NOW,
  online: true,
  running: false,
  pending: 0,
  signedIn: true,
  lastSyncAt: NOW - 5_000,
  lastError: null,
  retryAt: null,
  paused: false,
}

const error = (kind: SyncError['kind'], message = 'Something went wrong.', at = NOW - 1000) => ({
  kind,
  message,
  at,
})

const full = (input: Partial<SyncStatusInput>): string => {
  const line = describeSync({ ...base, ...input })
  return line.lead + line.tail
}

describe('the sentences shared with the repo engine', () => {
  it('are the ones it stores', () => {
    expect(SIGNED_OUT_TEXT).toBe(SYNC_TEXT.signedOut)
    expect(UPDATE_NEEDED_TEXT).toBe(SYNC_TEXT.updateNeeded)
  })
})

describe('formatAgo', () => {
  it('reads like a person would say it', () => {
    expect(formatAgo(0)).toBe('just now')
    expect(formatAgo(59_999)).toBe('just now')
    expect(formatAgo(MIN)).toBe('1 minute ago')
    expect(formatAgo(12 * MIN + 10_000)).toBe('12 minutes ago')
    expect(formatAgo(60 * MIN)).toBe('1 hour ago')
    expect(formatAgo(5 * 60 * MIN)).toBe('5 hours ago')
    expect(formatAgo(24 * 60 * MIN)).toBe('yesterday')
    expect(formatAgo(3 * 24 * 60 * MIN)).toBe('3 days ago')
  })

  it('treats a clock that stepped back as just now', () => {
    expect(formatAgo(-5000)).toBe('just now')
  })
})

describe('formatWait', () => {
  it('rounds up to whole minutes and never says seconds', () => {
    expect(formatWait(15_000)).toBe('less than a minute')
    expect(formatWait(MIN)).toBe('less than a minute')
    expect(formatWait(MIN + 1)).toBe('2 minutes')
    expect(formatWait(5 * MIN)).toBe('5 minutes')
    expect(formatWait(15 * MIN)).toBe('15 minutes')
    expect(formatWait(60 * MIN)).toBe('1 hour')
    expect(formatWait(61 * MIN)).toBe('2 hours')
  })
})

describe('describeSync', () => {
  it('says how long ago the last sync was, calmly', () => {
    expect(full({})).toBe('Synced · just now')
    expect(full({ lastSyncAt: NOW - 12 * MIN })).toBe('Synced · 12 minutes ago')
    expect(describeSync(base).tone).toBe('ok')
  })

  it('announces only the state, never the clock', () => {
    const a = describeSync({ ...base, lastSyncAt: NOW - 1000 })
    const b = describeSync({ ...base, lastSyncAt: NOW - 30 * MIN })
    expect(a.lead).toBe('Synced')
    expect(b.lead).toBe(a.lead)
    expect(a.tail).not.toBe(b.tail)
  })

  it('counts the changes waiting', () => {
    expect(full({ pending: 1 })).toBe('1 change waiting')
    expect(full({ pending: 3 })).toBe('3 changes waiting')
    expect(describeSync({ ...base, pending: 3 }).tone).toBe('quiet')
  })

  it('says offline when the browser is offline or the last try could not reach the project', () => {
    expect(full({ online: false })).toBe(OFFLINE_TEXT)
    expect(full({ lastError: error('offline') })).toBe(OFFLINE_TEXT)
    expect(full({ online: false, pending: 4 })).toBe(OFFLINE_TEXT)
  })

  it('says syncing while a cycle runs, unless something needs the person', () => {
    expect(full({ running: true, pending: 2 })).toBe('Syncing…')
    expect(full({ running: true, lastError: error('signedOut') })).toBe(SYNC_TEXT.signedOut)
  })

  it('names the wait after a failure', () => {
    const lastError = error('server')
    expect(full({ lastError, retryAt: NOW + 5 * MIN })).toBe('Trying again in 5 minutes.')
    expect(full({ lastError, retryAt: NOW + 10_000 })).toBe('Trying again in less than a minute.')
    expect(full({ lastError: error('rateLimited'), retryAt: NOW + MIN })).toBe(
      'Trying again in less than a minute.',
    )
    // A tab that did not see the engine's schedule still says something true.
    expect(full({ lastError, retryAt: null })).toBe('Trying again shortly.')
    expect(describeSync({ ...base, lastError, retryAt: NOW + MIN }).tone).toBe('quiet')
  })

  it('treats a 413 that could not be split like any other retry', () => {
    expect(full({ lastError: error('tooLarge'), retryAt: NOW + 15 * MIN })).toBe(
      'Trying again in 15 minutes.',
    )
  })

  it('shows a note from a cycle that worked as it is', () => {
    const note = error('server', 'Vocab deck is too large to sync, so it stays on this device.', NOW - 9_000)
    expect(full({ lastError: note, lastSyncAt: NOW - 8_000 })).toBe(note.message)
    expect(full({ lastError: { ...note, kind: 'tooLarge' }, lastSyncAt: NOW - 8_000 })).toBe(
      note.message,
    )
  })

  it('shows a failed safety snapshot with its own words', () => {
    const lastError = error('snapshot', SYNC_TEXT.snapshot)
    expect(full({ lastError, lastSyncAt: null })).toBe(SYNC_TEXT.snapshot)
  })

  it('asks for the one thing each stopped state needs', () => {
    const cases = [
      ['signedOut', 'signIn', SYNC_TEXT.signedOut],
      ['setup', 'setup', SETUP_TEXT],
      ['forbidden', 'forbidden', FORBIDDEN_TEXT],
      ['updateNeeded', 'update', SYNC_TEXT.updateNeeded],
    ] as const
    for (const [kind, need, text] of cases) {
      const line = describeSync({ ...base, lastError: error(kind) })
      expect(line.need).toBe(need)
      expect(line.lead).toBe(text)
      expect(line.tone).toBe('attention')
    }
  })

  it('asks to sign in when there is no session, even with no error yet', () => {
    const line = describeSync({ ...base, signedIn: false })
    expect(line.need).toBe('signIn')
    expect(line.lead).toBe(SYNC_TEXT.signedOut)
  })

  it('suggests a paused project only when the engine says the answers repeated', () => {
    expect(describeSync({ ...base, lastError: error('server'), retryAt: NOW + MIN }).need).toBeNull()
    const line = describeSync({ ...base, lastError: error('server'), paused: true })
    expect(line.need).toBe('paused')
    expect(line.lead).toBe(PAUSED_TEXT)
  })

  it('has a line before the first sync has finished', () => {
    expect(full({ lastSyncAt: null })).toBe('Waiting for the first sync.')
  })

  it('never uses guilt or counts of what is missing', () => {
    const lines = [
      full({}),
      full({ pending: 12 }),
      full({ online: false }),
      full({ lastError: error('server'), retryAt: NOW + 5 * MIN }),
      full({ lastSyncAt: null }),
    ]
    for (const line of lines) expect(line).not.toMatch(/behind|overdue|missing|!|failed/i)
  })
})

describe('clockWarning', () => {
  it('stays quiet within two minutes either way, and when unknown', () => {
    expect(clockWarning(null)).toBeNull()
    expect(clockWarning(0)).toBeNull()
    expect(clockWarning(CLOCK_WARNING_MS)).toBeNull()
    expect(clockWarning(-CLOCK_WARNING_MS)).toBeNull()
    expect(clockWarning(Number.NaN)).toBeNull()
  })

  it('says which way the clock is off, in whole minutes', () => {
    expect(clockWarning(7 * MIN)).toBe(
      "This device's clock is 7 minutes behind. Sync keeps the newest change by time, so set the clock to update automatically.",
    )
    expect(clockWarning(-3 * MIN)).toContain('3 minutes ahead')
    expect(clockWarning(2 * MIN + 31_000)).toContain('3 minutes behind')
  })
})

describe('progressText', () => {
  it('counts quietly', () => {
    expect(progressText(null)).toBe('Getting started…')
    expect(progressText({ step: 'snapshot', rows: 0 })).toBe('Saving a snapshot first…')
    expect(progressText({ step: 'pull', rows: 0 })).toBe('Reading your cloud copy…')
    expect(progressText({ step: 'merge', rows: 1 })).toBe('1 item so far')
    expect(progressText({ step: 'merge', rows: 1240 })).toBe('1,240 items so far')
    expect(progressText({ step: 'push', rows: 312 })).toBe('Sent 312 items')
  })
})

describe('sectionState', () => {
  const off: SectionInput = {
    enabled: false,
    phase: 'off',
    url: null,
    anonKey: null,
    pendingLogin: null,
    signedIn: false,
  }
  const project = {
    url: 'https://abcdefghijklmnopqrst.supabase.co',
    anonKey: ['sb', 'publishable', 'FAKEKEY00000000'].join('_'),
  }

  it('is the introduction until a project is saved', () => {
    expect(sectionState(off)).toBe('notSetUp')
    expect(sectionState({ ...off, url: project.url })).toBe('notSetUp')
  })

  it('moves on to the email step, then to waiting for the email', () => {
    expect(sectionState({ ...off, ...project })).toBe('configured')
    expect(sectionState({ ...off, ...project, pendingLogin: { email: 'ana@example.com' } })).toBe(
      'waiting',
    )
  })

  it('shows the first sync until the device has caught up', () => {
    const on = { ...off, ...project, enabled: true, signedIn: true }
    expect(sectionState({ ...on, phase: 'bootstrap' })).toBe('firstSync')
    expect(sectionState({ ...on, phase: 'steady' })).toBe('on')
  })

  it('a signed-out device stays in the on state, where it is asked to sign in again', () => {
    const on = { ...off, ...project, enabled: true }
    expect(sectionState({ ...on, phase: 'bootstrap', signedIn: false })).toBe('on')
    expect(sectionState({ ...on, phase: 'steady', signedIn: false, pendingLogin: {} })).toBe('on')
  })

  it('an enabled device is never back at the start', () => {
    expect(sectionState({ ...off, enabled: true, phase: 'steady', signedIn: true })).toBe('on')
  })
})
