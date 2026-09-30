/**
 * Which level the level-up moment has already shown (`settings.lastCelebratedLevel`). Both writes read
 * and write in one transaction, so two tabs watching the same database can never celebrate the same
 * level twice: only the one whose write lands first gets `true`.
 */
import { decideLevelCelebration } from '@/logic/xp'
import { db } from '../db'
import { getSettings, updateSettings } from './settings'

/**
 * Records `level` as celebrated when it is higher than the last one, and says whether it was: `true`
 * means "this caller owns the celebration". Never lowers the value.
 */
export async function claimLevelCelebration(level: number): Promise<boolean> {
  return db.transaction('rw', db.settings, async () => {
    const { lastCelebratedLevel } = await getSettings()
    const decision = decideLevelCelebration(lastCelebratedLevel, level)
    if (decision.kind !== 'celebrate') return false
    await updateSettings({ lastCelebratedLevel: decision.level })
    return true
  })
}

/**
 * First start: when no level was ever recorded, remembers `level` as already seen, so levels reached
 * by sample or imported data are not celebrated. Returns whether it wrote anything.
 */
export async function initCelebratedLevel(level: number): Promise<boolean> {
  return db.transaction('rw', db.settings, async () => {
    const { lastCelebratedLevel } = await getSettings()
    const decision = decideLevelCelebration(lastCelebratedLevel, level)
    if (decision.kind !== 'init') return false
    await updateSettings({ lastCelebratedLevel: decision.level })
    return true
  })
}
