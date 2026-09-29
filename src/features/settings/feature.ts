import { lazy } from 'react'
import type { FeatureManifest } from '@/app/registry'

/** Phase 1: theme select and data export only. Phase 10 replaces the page with full Settings. */
const manifest: FeatureManifest = {
  id: 'settings',
  routes: { settings: lazy(() => import('./SettingsPage')) },
}

export default manifest
