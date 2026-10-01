/**
 * The settings singleton (`id = 'app'`). Reads never write; `ensureSettings()` (called once at
 * boot) creates the row and backfills keys added by later releases.
 */
import { deepEqual } from '@/logic/deepEqual'
import { effectiveMixer } from '@/logic/soundMix'
import { db } from '../db'
import { SETTINGS_ID, defaultSettings, defaultSettingsData } from '../defaults'
import { emit, type SettingsSection } from '../events'
import type { Settings, SettingsData, SoundMixer } from '../types'

export type { SettingsSection } from '../events'

/**
 * Nested partial of the settings data. Plain objects merge key by key (including `tagColors`);
 * arrays and primitives replace; `undefined` is ignored; `null` sets null.
 */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T
export type SettingsPatch = DeepPartial<SettingsData>

type Obj = Record<string, unknown>

function isPlainObject(v: unknown): v is Obj {
  if (typeof v !== 'object' || v === null) return false
  const proto = Object.getPrototypeOf(v) as unknown
  return proto === Object.prototype || proto === null
}

function mergeObj(base: Obj, patch: Obj): Obj {
  const out: Obj = { ...base }
  for (const [k, pv] of Object.entries(patch)) {
    if (pv === undefined) continue
    const bv = out[k]
    out[k] = isPlainObject(pv) && isPlainObject(bv) ? mergeObj(bv, pv) : clone(pv)
  }
  return out
}

function clone<T>(v: T): T {
  return typeof v === 'object' && v !== null ? structuredClone(v) : v
}

/** Adds keys present in `defaults` but missing from `target` (recursively). Returns whether any were added. */
function backfill(target: Obj, defaults: Obj): boolean {
  let changed = false
  for (const [k, dv] of Object.entries(defaults)) {
    const tv = target[k]
    if (tv === undefined) {
      target[k] = clone(dv)
      changed = true
    } else if (isPlainObject(tv) && isPlainObject(dv) && k !== 'tagColors') {
      changed = backfill(tv, dv) || changed
    }
  }
  return changed
}

const BASE_KEYS = new Set(['id', 'createdAt', 'updatedAt'])

/** Pure deep merge of a patch into settings (never touches id/createdAt/updatedAt). */
export function mergeSettings(base: Settings, patch: SettingsPatch): Settings {
  const clean: Obj = {}
  for (const [k, v] of Object.entries(patch)) if (!BASE_KEYS.has(k)) clean[k] = v
  return mergeObj(base as unknown as Obj, clean) as unknown as Settings
}

/** A stored row with any keys missing from older releases filled from defaults (no write). */
export function withDefaults(stored: Settings): Settings {
  const copy = structuredClone(stored)
  backfill(copy as unknown as Obj, defaultSettingsData() as unknown as Obj)
  return copy
}

/** Current settings, or factory defaults if the row doesn't exist yet. Read-only; safe in liveQuery. */
export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get(SETTINGS_ID)
  return row ? withDefaults(row) : defaultSettings(Date.now())
}

/** Creates the row on first open and backfills new keys. Idempotent; call once at boot. */
export async function ensureSettings(): Promise<Settings> {
  return db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get(SETTINGS_ID)
    if (!row) {
      const fresh = defaultSettings(Date.now())
      await db.settings.add(fresh)
      return fresh
    }
    const copy = structuredClone(row)
    if (backfill(copy as unknown as Obj, defaultSettingsData() as unknown as Obj)) {
      copy.updatedAt = Date.now()
      await db.settings.put(copy)
    }
    return copy
  })
}

/**
 * Deep-merges `patch` into the settings row (creating it if needed) and emits
 * `settings.changed` after commit. Returns the saved settings. A patch that changes nothing (a toggle
 * set to the value it already has) writes nothing, leaves `updatedAt` alone and emits no event.
 */
export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const sections = (Object.keys(patch) as SettingsSection[]).filter(
    (k) => !BASE_KEYS.has(k) && patch[k] !== undefined,
  )
  return db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get(SETTINGS_ID)
    const now = Date.now()
    const base = row ? withDefaults(row) : defaultSettings(now)
    const next = mergeSettings(base, patch)
    if (row && deepEqual(next, base)) return base
    next.updatedAt = now
    await db.settings.put(next)
    if (sections.length > 0) emit({ type: 'settings.changed', sections })
    return next
  })
}

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
