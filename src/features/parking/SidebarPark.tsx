import { CircleParking } from 'lucide-react'
import { useRoute } from '@/app/router'
import { useTimer } from '@/features/focus'
import { Button } from '@/ui/Button'
import { openParking } from './store'
import styles from './SidebarPark.module.css'

/**
 * Slot `sidebar.timer`: under the mini timer, while a focus session runs on any page but Focus (where
 * the mini timer hides and the aside has this button), a quiet "Park a thought". `p` does the same.
 */
export function SidebarPark() {
  const timer = useTimer()
  const route = useRoute()
  if (timer.session?.kind !== 'focus' || route.name === 'focus') return null
  return (
    <Button
      variant="ghost"
      size="sm"
      iconLeft={<CircleParking />}
      className={styles.park}
      aria-keyshortcuts="P"
      data-testid="sidebar-park"
      onClick={openParking}
    >
      Park a thought
    </Button>
  )
}
