import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { holdCelebrations } from '@/app/celebrate'
import { recordError } from '@/app/reportError'
import { useSettings } from '@/db/hooks/useSettings'
import { useXp } from '@/db/hooks/useXp'
import { claimLevelCelebration, initCelebratedLevel } from '@/db/repos/levels'
import { decideLevelCelebration } from '@/logic/xp'

/** The overlay, its canvas and the sound load the first time there is something to celebrate. */
const LevelUpMoment = lazy(() => import('./LevelUpMoment'))

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}
const isVisible = (): boolean => document.visibilityState === 'visible'

/**
 * Slot `global.overlays`: watches lifetime XP and, when the level rises above
 * `settings.lastCelebratedLevel`, shows the level-up moment once, at the highest level reached (several
 * levels crossed at once are one celebration). The level is written down before the moment starts, so a
 * reload never repeats it and two open tabs cannot both show it. It waits for a visible tab, so a level
 * earned while the app is in the background is celebrated when you come back to it.
 *
 * With no level recorded yet (first start, restored backup) it records the current one and shows
 * nothing: levels reached by sample or imported data are not a moment.
 *
 * While the moment is open the celebration queue holds every toast back (a streak milestone, a badge, the
 * daily goal), so nothing competes with it; they show when it closes.
 */
export function LevelUp() {
  const xp = useXp()
  const settings = useSettings()
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => false)
  const [moment, setMoment] = useState<number | null>(null)
  const working = useRef(false)
  const releaseToasts = useRef<(() => void) | null>(null)

  // The hold is taken before the moment renders (a toast must not slip out in between) and lets go when
  // the moment ends or this component goes away.
  const endMoment = () => {
    releaseToasts.current?.()
    releaseToasts.current = null
    setMoment(null)
  }
  useEffect(() => () => releaseToasts.current?.(), [])

  const current = xp?.level.level
  const last = settings?.lastCelebratedLevel

  useEffect(() => {
    if (current === undefined || last === undefined || working.current) return
    const decision = decideLevelCelebration(last, current)
    if (decision.kind === 'none') return
    if (decision.kind === 'celebrate' && !visible) return
    working.current = true
    const run = async () => {
      try {
        if (decision.kind === 'init') {
          await initCelebratedLevel(decision.level)
        } else if (await claimLevelCelebration(decision.level)) {
          releaseToasts.current ??= holdCelebrations()
          setMoment(decision.level)
        }
      } catch (error) {
        recordError(error, 'level up')
      } finally {
        working.current = false
      }
    }
    void run()
  }, [current, last, visible])

  if (moment === null) return null
  return (
    <Suspense fallback={null}>
      <LevelUpMoment key={moment} level={moment} onDone={endMoment} />
    </Suspense>
  )
}
