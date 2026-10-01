/**
 * The reads behind My World. The city is never stored: every time the history changes it is rebuilt
 * from finished tasks, counted focus minutes, finished courses and goals, and the current streak, with
 * the one stored value being the seed of its generator (created once, kept in settings).
 *
 * The plain reads live in `@/db/repos/world` (and are tested there); this file wraps them in live
 * queries. A hook is `undefined` only while its first read is loading, and a failed read throws to the
 * nearest error boundary like any live query.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { recordError } from '@/app/reportError'
import { useStreak } from '@/db/hooks/useStreak'
import { ensureWorldSeed, loadWorldRows, type WorldRows } from '@/db/repos/world'
import type { ISODate } from '@/db/types'
import { valueSharer } from '@/logic/share'
import { buildWorld, type WorldInput, type WorldModel } from '@/logic/world'

/** The input for `buildWorld`, live. `undefined` while the history, the streak or the seed load. */
export function useWorldInput(today: ISODate): WorldInput | undefined {
  // Many writes re-run this read without changing the city (settings, a goal re-planned, a session
  // starting). Sharing keeps the same rows then, so the model is not rebuilt and the engine is not
  // updated, which would also put away a tooltip the person is reading.
  const [share] = useState(valueSharer<WorldRows>)
  const rows = useLiveQuery(async () => share(await loadWorldRows()), [share])
  const streak = useStreak(today)
  const seeded = rows !== undefined && rows.seed > 0

  // Created once, on the first visit: the live query above then runs again with it.
  useEffect(() => {
    if (rows === undefined || rows.seed > 0) return
    ensureWorldSeed().catch((e: unknown) => recordError(e, 'ensureWorldSeed'))
  }, [rows])

  const current = streak?.current
  return useMemo(
    () =>
      seeded && rows !== undefined && current !== undefined
        ? { ...rows, streakDays: current }
        : undefined,
    [seeded, rows, current],
  )
}

/**
 * The city model, live. A brand-new world still has its first plot of grass (`minPlots: 1`), so a new user
 * sees somewhere to build.
 */
export function useWorldModel(today: ISODate): WorldModel | undefined {
  const input = useWorldInput(today)
  return useMemo(() => (input ? buildWorld(input, { minPlots: 1 }) : undefined), [input])
}
