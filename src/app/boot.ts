import { setDomainErrorReporter, subscribeAll } from '@/db/events'
import { ensureSettings } from '@/db/repos/settings'
import type { ISODate } from '@/db/types'
import { recordError } from './reportError'
import type { Registry } from './registry'

/** Dev/e2e seeding: `?seed=wgu|empty` lazy-loads src/dev/seed.ts (added later; harmless while absent). */
const seedModules = import.meta.glob<{ applySeed: (kind: 'wgu' | 'empty') => Promise<void> }>(
  '../dev/seed.ts',
)

async function applySeedFromUrl(): Promise<void> {
  const url = new URL(window.location.href)
  const kind = url.searchParams.get('seed')
  if (kind !== 'wgu' && kind !== 'empty') return
  const load = Object.values(seedModules)[0]
  if (load) {
    try {
      await (await load()).applySeed(kind)
    } catch (e) {
      recordError(e, 'seed')
    }
  }
  url.searchParams.delete('seed')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

/**
 * One-time startup, before first render: seed (dev only), create the settings row, route domain-event
 * errors to the in-memory log, and subscribe every feature's domain handlers. Returns the unsubscribe.
 */
export async function bootApp(registry: Registry): Promise<() => void> {
  await applySeedFromUrl()
  try {
    await ensureSettings()
  } catch (e) {
    // A blocked or corrupt database is surfaced by the first live query and the root ErrorBoundary.
    recordError(e, 'ensureSettings')
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
