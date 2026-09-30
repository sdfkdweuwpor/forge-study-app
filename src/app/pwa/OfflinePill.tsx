import { WifiOff } from 'lucide-react'
import { useOnline } from './useOnline'
import styles from './OfflinePill.module.css'

/**
 * A quiet "Offline" pill. Nothing needs it (data is local, the app works the same), so it only informs.
 * `sidebar` sits in the sidebar footer (desktop, and the tablet drawer); `floating` covers the pages
 * that have no sidebar on screen (below 1024 px) and never takes a tap.
 */
function OfflinePill({ variant }: { variant: 'sidebar' | 'floating' }) {
  const online = useOnline()
  if (online) return null
  return (
    <div
      className={styles.pill}
      data-variant={variant}
      data-testid={`offline-pill-${variant}`}
      role="status"
    >
      <WifiOff size={14} strokeWidth={1.75} aria-hidden="true" />
      <span>Offline</span>
    </div>
  )
}

/** Slot `sidebar.footer`. */
export function SidebarOfflinePill() {
  return <OfflinePill variant="sidebar" />
}

/** Slot `global.overlays`; visible below 1024 px only (its CSS). */
export function FloatingOfflinePill() {
  return <OfflinePill variant="floating" />
}
