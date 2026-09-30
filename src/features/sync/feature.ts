import { RefreshCw } from 'lucide-react'
import { lazy } from 'react'
import type { FeatureManifest } from '@/app/registry'
import { recordError } from '@/app/reportError'
import { settleStartupSync } from '@/db/repos/syncGate'
import { startSyncEngine, syncNow } from './index'
import { onTrackedWrite, syncIsOn } from './queries'

const SyncSection = lazy(() => import('./SyncSection').then((m) => ({ default: m.SyncSection })))

const start = (): void => {
  startSyncEngine().catch((e: unknown) => {
    recordError(e, 'sync.start')
    settleStartupSync()
  })
}

let watching = false

/**
 * Cloud sync (Phase 12, PLAN §4.7): the only part of it that is always loaded. Off by default, and while it
 * is off nothing else loads, fetches or runs: the engine, the Supabase client and the Settings section are
 * imported on demand. A tab that never had sync on waits for its first tracked write (another tab turned
 * it on) and starts its engine then.
 */
const manifest: FeatureManifest = {
  id: 'sync',
  commands: [
    {
      id: 'command.sync.now',
      title: 'Sync now',
      group: 'Data',
      icon: RefreshCw,
      keywords: ['cloud', 'supabase', 'refresh', 'upload', 'download'],
      when: syncIsOn,
      run: () => syncNow(),
    },
    {
      id: 'command.sync.settings',
      title: 'Sync settings',
      group: 'Data',
      keywords: ['cloud', 'supabase', 'devices', 'laptop', 'phone', 'sign in'],
      run: (c) => c.navigate('settings', { section: 'sync' }),
    },
  ],
  slots: [{ slot: 'settings.sections', id: 'sync', order: 65, component: SyncSection }],
  onAppStart: async () => {
    if (syncIsOn()) return start()
    if (watching) return
    watching = true
    const stop = onTrackedWrite(() => {
      stop()
      watching = false
      start()
    })
  },
}

export default manifest
