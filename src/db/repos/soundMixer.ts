/**
 * The sound mixer's writes. Its own module (not in `settings.ts`) so the mixer logic loads with the
 * sound code, not with the app.
 */
import { deepEqual } from '@/logic/deepEqual'
import { effectiveMixer } from '@/logic/soundMix'
import { db } from '../db'
import { SETTINGS_ID, defaultSettings } from '../defaults'
import { emit } from '../events'
import type { Settings, SoundMixer } from '../types'
import { withDefaults } from './settings'

/**
 * Changes the sound mixer. `update` gets the mixer in use (stored, or derived from the older ambient
 * fields) and runs inside the write transaction, so overlapping changes cannot lose each other.
 * `updateSettings` deep-merges and cannot drop a layer key; this replaces the whole object. Writes
 * nothing (and emits nothing) when the result is unchanged.
 */
export async function replaceMixer(update: (current: SoundMixer) => SoundMixer): Promise<Settings> {
  return db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get(SETTINGS_ID)
    const now = Date.now()
    const base = row ? withDefaults(row) : defaultSettings(now)
    const next = structuredClone(base)
    next.sound.mixer = structuredClone(update(effectiveMixer(base.sound)))
    if (row && deepEqual(next, base)) return base
    next.updatedAt = now
    await db.settings.put(next)
    emit({ type: 'settings.changed', sections: ['sound'] })
    return next
  })
}
