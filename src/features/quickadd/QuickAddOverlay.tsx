import { useOpenOverlays } from '@/app/providers/OverlayProvider'
import { QuickAddDialog } from './QuickAddDialog'

/** Slot component (`global.overlays`): renders the dialog while the shell says quick add is open. */
export function QuickAddOverlay() {
  const open = useOpenOverlays().includes('quickAdd')
  return open ? <QuickAddDialog /> : null
}
