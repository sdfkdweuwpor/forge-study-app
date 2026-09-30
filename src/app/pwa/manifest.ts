import { RefreshCw } from 'lucide-react'
import type { FeatureManifest } from '../registry/types'
import { LaunchActions } from './LaunchActions'
import { FloatingOfflinePill, SidebarOfflinePill } from './OfflinePill'
import { PwaHost } from './PwaHost'
import { UpdatePrompt } from './UpdatePrompt'
import { updateStore } from './updateStore'

/**
 * PWA behaviour (Phase 10C): service worker registration, the "Update ready" toast, the Offline pill
 * and the installed app's launch shortcuts. Registered by `registry/discover.ts` like the palette.
 */
export const pwaManifest: FeatureManifest = {
  id: 'pwa',
  commands: [
    {
      id: 'command.pwa.reload',
      title: 'Reload to update Forge',
      group: 'Help',
      icon: RefreshCw,
      keywords: ['update', 'new version', 'refresh', 'upgrade'],
      when: () => updateStore.getPhase() !== 'idle',
      run: () => updateStore.apply(),
    },
  ],
  slots: [
    { slot: 'global.overlays', id: 'pwa.host', order: 90, component: PwaHost },
    { slot: 'global.overlays', id: 'pwa.updatePrompt', order: 91, component: UpdatePrompt },
    { slot: 'global.overlays', id: 'pwa.launchActions', order: 92, component: LaunchActions },
    {
      slot: 'global.overlays',
      id: 'pwa.offlineFloating',
      order: 93,
      component: FloatingOfflinePill,
    },
    { slot: 'sidebar.footer', id: 'pwa.offline', order: 90, component: SidebarOfflinePill },
  ],
}
