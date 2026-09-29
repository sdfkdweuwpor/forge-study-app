import { PanelLeftClose, Search } from 'lucide-react'
import { useOverlays } from '../providers/OverlayProvider'
import { Slot, useSlotCount } from '../registry'
import { Link, useRoute } from '../router'
import type { RouteName } from '../router'
import { Logo } from './Logo'
import { PRIMARY_NAV, SECONDARY_NAV, TASK_SUBNAV, isNavActive, keyHint, type NavItem } from './nav'
import styles from './Sidebar.module.css'

interface SidebarProps {
  /** Called after any navigation or action that should dismiss a drawer. */
  onNavigate?: () => void
  /** Renders the collapse button (desktop) — omit inside the drawer. */
  onCollapse?: () => void
  /** Roomier rows for touch (drawer). */
  touch?: boolean
}

function NavRow({
  item,
  route,
  onNavigate,
  subActive = false,
}: {
  item: NavItem
  route: RouteName
  onNavigate?: () => void
  /** A child link is the current page, so this row stays plain. */
  subActive?: boolean
}) {
  const active = isNavActive(item, route) && !subActive
  const Icon = item.icon
  return (
    <Link
      to={item.to}
      className={styles.row}
      aria-current={active ? 'page' : undefined}
      data-active={active || undefined}
      onClick={onNavigate}
    >
      <Icon className={styles.icon} size={18} strokeWidth={1.75} aria-hidden="true" />
      <span className={styles.label}>{item.label}</span>
    </Link>
  )
}

/** Sidebar per BRIEF §4: logo + search, nav, divider, Blocker/Settings, and the timer/level footer slots. */
export function Sidebar({ onNavigate, onCollapse, touch = false }: SidebarProps) {
  const route = useRoute()
  const overlays = useOverlays()
  const inTasks = route.name === 'tasks' || route.name === 'taskView' || route.name === 'task'
  const activeList = route.name === 'tasks' ? (route.params.list ?? 'inbox') : null
  // Empty slots render nothing, and so must their wrappers (no stray bullets, gaps or separators).
  const hasGoalLinks = useSlotCount('sidebar.nav.goals') > 0
  const hasFooter = useSlotCount('sidebar.timer') + useSlotCount('sidebar.footer') > 0

  return (
    <div className={styles.sidebar} data-touch={touch || undefined}>
      <div className={styles.top}>
        <Link
          to="today"
          className={styles.brand}
          aria-label="Forge, go to Today"
          onClick={onNavigate}
        >
          <Logo />
          <span className={styles.brandName}>Forge</span>
        </Link>
        {onCollapse ? (
          <button
            type="button"
            className={styles.iconButton}
            data-sidebar-collapse=""
            onClick={onCollapse}
            aria-label="Collapse sidebar"
            title={`Collapse sidebar  ${keyHint('mod+\\')}`}
          >
            <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className={styles.search}
        aria-label="Search and commands"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => {
          overlays.open('palette')
          onNavigate?.()
        }}
      >
        <Search size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className={styles.searchLabel}>Search</span>
        <span className={styles.hint} aria-hidden="true">
          {keyHint('mod+k')}
        </span>
      </button>

      <nav aria-label="Main" className={styles.scroll}>
        <ul className={styles.list}>
          {PRIMARY_NAV.map((item) => (
            <li key={item.id}>
              <NavRow
                item={item}
                route={route.name}
                onNavigate={onNavigate}
                subActive={item.id === 'tasks' && activeList !== null}
              />
              {item.id === 'tasks' && inTasks ? (
                <ul className={styles.sub}>
                  {TASK_SUBNAV.map((sub) => {
                    const active = activeList === sub.list
                    const Icon = sub.icon
                    return (
                      <li key={sub.list}>
                        <Link
                          to="tasks"
                          params={{ list: sub.list }}
                          className={styles.row}
                          data-sub
                          data-active={active || undefined}
                          aria-current={active ? 'page' : undefined}
                          onClick={onNavigate}
                        >
                          <Icon
                            className={styles.icon}
                            size={16}
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                          <span className={styles.label}>{sub.label}</span>
                        </Link>
                      </li>
                    )
                  })}
                  <Slot id="sidebar.nav.tasks" />
                </ul>
              ) : null}
              {item.id === 'goals' && hasGoalLinks ? (
                <ul className={styles.sub}>
                  <Slot id="sidebar.nav.goals" />
                </ul>
              ) : null}
            </li>
          ))}
        </ul>

        <hr className={styles.divider} />

        <ul className={styles.list}>
          {SECONDARY_NAV.map((item) => (
            <li key={item.id}>
              <NavRow item={item} route={route.name} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>

      {/* The timer and level footer are status widgets, not navigation: outside the nav landmark. */}
      {hasFooter ? (
        <div className={styles.bottom}>
          <Slot id="sidebar.timer" />
          <Slot id="sidebar.footer" />
        </div>
      ) : null}
    </div>
  )
}
