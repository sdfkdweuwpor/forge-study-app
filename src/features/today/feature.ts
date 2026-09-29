import { lazy } from 'react'
import type { FeatureManifest } from '@/app/registry'

/** Phase 1: hello page only. Phase 3 (3E) replaces the page with the real Today. */
const manifest: FeatureManifest = {
  id: 'today',
  routes: { today: lazy(() => import('./TodayPage')) },
}

export default manifest
