import { RefreshCw } from 'lucide-react'
import { lazy } from 'react'
import type { FeatureManifest } from '@/app/registry'
import { recordError } from '@/app/reportError'
import { settleStartupSync } from '@/db/repos/syncGate'
import { startSyncEngine, syncNow } from './index'
import { onTrackedWrite, syncIsOn } from './queries'

const SyncSection = lazy(() => import('./SyncSection').then((m) => ({ default: m.SyncSection })))

const start = (wrote = false): void => {
  startSyncEngine({ wrote }).catch((e: unknown) => {
    recordError(e, 'sync.start')
    settleStartupSync()
  })
}

let watching = false

/**
 * Cloud sync (Phase 12, PLAN §4.7): the only part of it that is always loaded. Off by default, and while it
 * is off nothing else loads, fetches or runs: the engine, the Supabase client and the Settings section are
 * imported on demand. A tab without an engine gets one on its next tracked write (`onAppStart`).
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
    // A tracked write (only ever made while sync is on) is a reason to have an engine in this tab: one
    // that was opened before sync was turned on (in another tab) gets its first, and one that stopped
    // because sync was turned off elsewhere and on again starts anew. While one runs, `startEngine` just
    // returns it. The watcher is never removed, and only ever registered once.
    if (!watching) {
      watching = true
      onTrackedWrite(() => start(true))
    }
    if (syncIsOn()) start()
  },
}

export default manifest
