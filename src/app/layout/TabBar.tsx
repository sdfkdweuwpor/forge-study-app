import { Plus } from 'lucide-react'
import { useOverlays } from '../providers/OverlayProvider'
import { Link, useRoute } from '../router'
import { MORE_NAV, MoreIcon, TAB_NAV, isNavActive } from './nav'
import styles from './TabBar.module.css'

interface TabBarProps {
  moreOpen: boolean
  onToggleMore: () => void
}

/** Bottom tab bar under 640px (BRIEF §3.8) plus the floating "+" quick-add button. */
export function TabBar({ moreOpen, onToggleMore }: TabBarProps) {
  const route = useRoute()
  const overlays = useOverlays()
  const moreActive = MORE_NAV.some((item) => isNavActive(item, route.name))

  return (
    <>
      <button
        type="button"
        className={styles.fab}
        aria-label="Quick add task"
        onClick={() => overlays.open('quickAdd')}
      >
        <Plus size={24} strokeWidth={2} aria-hidden="true" />
      </button>
      <nav aria-label="Main" className={styles.bar}>
        {TAB_NAV.map((item) => {
          const active = isNavActive(item, route.name)
          const Icon = item.icon
          return (
            <Link
              key={item.id}
              to={item.to}
              className={styles.tab}
              aria-current={active ? 'page' : undefined}
              data-active={active || undefined}
            >
              <Icon size={22} strokeWidth={active ? 2 : 1.75} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          )
        })}
        <button
          type="button"
          className={styles.tab}
          data-active={moreActive || undefined}
          aria-current={moreActive ? 'true' : undefined}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={onToggleMore}
        >
          <MoreIcon size={22} strokeWidth={moreActive ? 2 : 1.75} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>
    </>
  )
}
