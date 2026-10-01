import { db } from '@/db/db'
import { setDomainErrorReporter, subscribeAll } from '@/db/events'
import { ensureSettings } from '@/db/repos/settings'
import type { ISODate } from '@/db/types'
import { setFatal } from './fatal'
import { recordError } from './reportError'
import type { Registry } from './registry'

export type SeedKind = 'wgu' | 'wgu-year' | 'empty'
type SeedModule = { applySeed: (kind: SeedKind) => Promise<void> }

/**
 * `?seed=` replaces the user's data, so it exists only in builds that opt in at build time
 * (`VITE_ENABLE_SEED=1`: `npm run dev` and the Playwright web servers). A deployed build has neither
 * the flag nor the seed module (the constant folds away and the dynamic import is dropped), so a crafted
 * link cannot wipe anyone's data, whether or not the database already holds any.
 */
const SEED_ENABLED = import.meta.env.VITE_ENABLE_SEED === '1'

const seedModules: Record<string, () => Promise<SeedModule>> = SEED_ENABLED
  ? import.meta.glob<SeedModule>('../dev/seed.ts')
  : {}

/** Which seed a query string asks for, or null when it asks for none or seeding is disabled. */
export function seedRequest(search: string, enabled: boolean): SeedKind | null {
  if (!enabled) return null
  const kind = new URLSearchParams(search).get('seed')
  return kind === 'wgu' || kind === 'wgu-year' || kind === 'empty' ? kind : null
}

async function applySeedFromUrl(): Promise<void> {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('seed')) return
  const kind = seedRequest(url.search, SEED_ENABLED)
  if (kind) {
    const load = Object.values(seedModules)[0]
    if (load) {
      try {
        await (await load()).applySeed(kind)
      } catch (e) {
        recordError(e, 'seed')
      }
    }
  } else if (!SEED_ENABLED) {
    recordError(new Error('?seed= ignored: seeding is not enabled in this build'), 'seed')
  }
  // Drop the parameter either way, so a reload or a shared address never repeats it.
  url.searchParams.delete('seed')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

/** `ResizeObserver loop…` is a benign browser notice, not an application error. */
const isBenignWindowError = (message: string) => message.startsWith('ResizeObserver loop')

let globalListenersInstalled = false

/** Routes uncaught errors and unhandled promise rejections to the in-memory error log (there is no console). */
export function installGlobalErrorListeners(): void {
  if (globalListenersInstalled) return
  globalListenersInstalled = true
  window.addEventListener('error', (e) => {
    if (isBenignWindowError(e.message)) return
    recordError(e.error ?? e.message, 'window.error')
  })
  window.addEventListener('unhandledrejection', (e) => {
    recordError(e.reason, 'unhandledrejection')
  })
}

/**
 * Another tab running a newer build can upgrade the schema (or delete the database) while this tab
 * is open. Dexie would reopen at the old version and fail confusingly, so close for good and say why.
 */
export function guardDatabaseVersion(): void {
  db.on('versionchange', () => {
    db.close()
    setFatal({ kind: 'db-stale' })
  })
}

/** Asks the browser not to evict the database under storage pressure. Fire and forget; failures are fine. */
export function requestPersistentStorage(): void {
  try {
    const pending = navigator.storage?.persist?.()
    pending?.catch(() => undefined)
  } catch {
    /* storage manager unavailable */
  }
}

/**
 * One-time startup, before first render: seed (dev only), create the settings row, route domain-event
 * errors to the in-memory log, and subscribe every feature's domain handlers. Returns the unsubscribe.
 * Rejects when the database cannot be opened; the caller shows the failure screen.
 */
export async function bootApp(registry: Registry): Promise<() => void> {
  guardDatabaseVersion()
  await applySeedFromUrl()
  try {
    await ensureSettings()
  } catch (e) {
    recordError(e, 'ensureSettings')
    throw e
  }
  setDomainErrorReporter((error, info) =>
    recordError(error, `${info.handlerId} on ${info.event.type}`),
  )
  return subscribeAll(registry.domainHandlers)
}

/** Runs every feature's `onAppStart` once per call; a failing feature never blocks the others. */
export async function runAppStart(registry: Registry, now: number, today: ISODate): Promise<void> {
  for (const m of registry.manifests) {
    if (!m.onAppStart) continue
    try {
      await m.onAppStart({ now, today })
    } catch (e) {
      recordError(e, `${m.id}.onAppStart`)
    }
  }
}
