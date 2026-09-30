import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAllData } from '@/db/repos/backup'
import { createTask } from '@/db/repos/tasks'
import { countTrash, moveToTrash } from '@/db/repos/trash'
import { CLOCK_JUMP_MS } from '@/logic/retention'
import { purgeTrashDaily } from './chores'

const DAY = 24 * 60 * 60 * 1000
// Tue 2026-09-29 09:30 in America/New_York; an item trashed then is due Thu 2026-10-29 09:30.
const NOW = new Date(2026, 8, 29, 9, 30).getTime()
const dayOf = (ms: number): string => new Date(ms).toLocaleDateString('en-CA')

/** A device's localStorage, in memory: `readPref`/`writePref` reach it through `window`. */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })
  return store
}

let store: Map<string, string>

/** One start of the app at `now`. */
const start = (now: number) => purgeTrashDaily(now, dayOf(now))

async function trashOne(title: string): Promise<void> {
  const task = await createTask({ title }, { now: NOW })
  await moveToTrash('tasks', task.id, { now: NOW })
}

beforeEach(async () => {
  await resetAllData()
  store = stubStorage()
})

describe('purgeTrashDaily', () => {
  it('removes what is due, and records the day and the start', async () => {
    await trashOne('Renew library card')
    expect(await start(NOW + 29 * DAY)).toBe(0)
    expect(await countTrash()).toBe(1)
    expect(store.get('forge:trash:purged-day')).toBe(dayOf(NOW + 29 * DAY))

    expect(await start(NOW + 30 * DAY + 60_000)).toBe(1)
    expect(await countTrash()).toBe(0)
    expect(store.get('forge:trash:purged-day')).toBe(dayOf(NOW + 30 * DAY))
    expect(store.get('forge:trash:last-seen')).toBe(String(NOW + 30 * DAY + 60_000))
  })

  it('runs once a local day: a second start the same day purges nothing more', async () => {
    await trashOne('Renew library card')
    const morning = NOW + 30 * DAY - 2 * 60 * 60 * 1000 // 07:30, before it is due
    expect(await start(morning)).toBe(0)
    // The item is due by the afternoon, but today's purge already ran.
    expect(await start(morning + 5 * 60 * 60 * 1000)).toBe(0)
    expect(await countTrash()).toBe(1)
    expect(await start(NOW + 31 * DAY)).toBe(1)
  })

  it('an ordinary gap between starts (two days or less) still purges', async () => {
    await trashOne('Renew library card')
    await start(NOW + 29 * DAY)
    expect(await start(NOW + 29 * DAY + CLOCK_JUMP_MS)).toBe(1)
    expect(await countTrash()).toBe(0)
  })

  it('skips the start after a jump of more than two days, keeps the items, and purges at the next start', async () => {
    await trashOne('Renew library card')
    await trashOne('Reply to Financial Aid about the term 2 disbursement')
    await start(NOW + DAY)
    // The clock is now years ahead: everything looks expired.
    const wrong = new Date(2031, 0, 1, 9, 0).getTime()
    expect(await start(wrong)).toBe(0)
    expect(await countTrash()).toBe(2)
    // Not recorded as purged, so the chore is still due; the start is noted for the next comparison.
    expect(store.get('forge:trash:purged-day')).toBe(dayOf(NOW + DAY))
    expect(store.get('forge:trash:last-seen')).toBe(String(wrong))
    expect(await start(wrong + DAY)).toBe(2)
    expect(await countTrash()).toBe(0)
  })

  it('does not count the first start ever (nothing recorded) as a jump', async () => {
    await trashOne('Renew library card')
    expect(store.size).toBe(0)
    expect(await start(NOW + 40 * DAY)).toBe(1)
  })

  it('a clock set back purges nothing and is not a jump; an unreadable stored time counts as none', async () => {
    await trashOne('Renew library card')
    await start(NOW + 10 * DAY)
    // Set back to an earlier day: the chore already ran on a later one.
    expect(await start(NOW + 5 * DAY)).toBe(0)
    expect(await countTrash()).toBe(1)
    store.set('forge:trash:last-seen', 'garbage')
    expect(await start(NOW + 100 * DAY)).toBe(1)
  })
})
