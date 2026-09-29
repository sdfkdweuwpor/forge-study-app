import { PanelLeft } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { PREF_KEYS, readBoolPref, readNumberPref, writeBoolPref, writePref } from '@/lib/localPrefs'
import { BREAKPOINTS, useMediaQuery } from '../hooks/useMediaQuery'
import { Slot } from '../registry'
import { RouteView } from '../RouteView'
import { usePathname, useRoute } from '../router'
import { useShortcutHandler } from '../shortcuts'
import { Drawer } from './Drawer'
import { MoreSheet } from './MoreSheet'
import { Resizer, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from './Resizer'
import { RightPanel } from './RightPanel'
import { RouteAnnouncer } from './RouteAnnouncer'
import styles from './Shell.module.css'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { keyHint } from './nav'

type Overlay = 'drawer' | 'more'

/** App layout: sidebar (desktop) / drawer (tablet) / tab bar (mobile) around the routed page. */
export function Shell() {
  const isDesktop = useMediaQuery(BREAKPOINTS.desktop)
  const isTablet = useMediaQuery(BREAKPOINTS.tablet)
  const mode = isDesktop ? 'desktop' : isTablet ? 'tablet' : 'mobile'

  const route = useRoute()
  const pathname = usePathname()

  const [collapsed, setCollapsed] = useState(() => readBoolPref(PREF_KEYS.sidebarCollapsed, false))
  const [width, setWidth] = useState(() =>
    readNumberPref(PREF_KEYS.sidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX),
  )
  const [resizing, setResizing] = useState(false)

  // The tablet drawer / mobile More sheet belong to the page and breakpoint they were opened on. When
  // either changes they are closed for good (state is reset while rendering, not remembered by key),
  // so returning to that page later, or going back, never reopens them.
  const overlayScope = `${pathname}|${mode}`
  const [scope, setScope] = useState(overlayScope)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  if (scope !== overlayScope) {
    setScope(overlayScope)
    setOverlay(null)
  }
  const drawerOpen = overlay === 'drawer' && mode === 'tablet'
  const moreOpen = overlay === 'more' && mode === 'mobile'
  const overlayOpen = drawerOpen || moreOpen

  const closeOverlay = useCallback(() => setOverlay(null), [])
  const toggleOverlay = (kind: Overlay) => setOverlay((cur) => (cur === kind ? null : kind))

  // Collapsing or expanding with a button hides the button that was pressed; focus follows to its twin.
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const focusTwin = useRef<'open' | 'collapse' | null>(null)
  useEffect(() => {
    const target = focusTwin.current
    if (target === null) return
    focusTwin.current = null
    if (target === 'open') openButtonRef.current?.focus()
    else sidebarRef.current?.querySelector<HTMLElement>('[data-sidebar-collapse]')?.focus()
  }, [collapsed])

  const toggleSidebar = useCallback(() => {
    if (mode === 'desktop') {
      const next = !collapsed
      setCollapsed(next)
      writeBoolPref(PREF_KEYS.sidebarCollapsed, next)
    } else if (mode === 'tablet') {
      setOverlay((cur) => (cur === 'drawer' ? null : 'drawer'))
    }
  }, [mode, collapsed])
  useShortcutHandler('app.toggleSidebar', toggleSidebar)

  /** The buttons (not the shortcut, which may be pressed from anywhere) also move focus to the twin button. */
  const toggleSidebarFromButton = () => {
    if (mode === 'desktop') focusTwin.current = collapsed ? 'collapse' : 'open'
    toggleSidebar()
  }

  const commitWidth = (px: number) => {
    setWidth(px)
    writePref(PREF_KEYS.sidebarWidth, String(px))
  }

  const sidebarHidden = mode === 'desktop' && collapsed
  const showOpenButton = sidebarHidden || mode === 'tablet'

  // Pages with params (a goal, a course, a task) remount when the params change, so no state leaks between them.
  const pageKey = Object.keys(route.params).length > 0 ? pathname : route.name

  return (
    <div
      className={styles.shell}
      data-mode={mode}
      data-resizing={resizing || undefined}
      style={{ '--sidebar-w': `${width}px` } as CSSProperties}
    >
      <a
        href="#main"
        className={styles.skip}
        inert={overlayOpen}
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        Skip to content
      </a>

      {mode === 'desktop' ? (
        <div
          ref={sidebarRef}
          className={styles.sidebarWrap}
          data-collapsed={collapsed || undefined}
          inert={collapsed}
        >
          <div className={styles.sidebarInner}>
            <Sidebar onCollapse={toggleSidebarFromButton} />
          </div>
          <Resizer
            width={width}
            dragging={resizing}
            onDragStart={() => setResizing(true)}
            onDrag={setWidth}
            onCommit={commitWidth}
            onDragEnd={() => setResizing(false)}
          />
        </div>
      ) : null}

      <div className={styles.content} inert={overlayOpen}>
        {showOpenButton ? (
          <button
            ref={openButtonRef}
            type="button"
            className={styles.openButton}
            onClick={toggleSidebarFromButton}
            aria-label="Open sidebar"
            aria-expanded={mode === 'tablet' ? drawerOpen : !collapsed}
            title={`Open sidebar  ${keyHint('mod+\\')}`}
          >
            <PanelLeft size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
        <main id="main" tabIndex={-1} className={styles.main}>
          <div className={styles.pageOuter}>
            <div className={styles.page} key={pageKey}>
              <RouteView />
            </div>
          </div>
        </main>
      </div>

      {mode === 'desktop' ? <RightPanel /> : null}

      {mode === 'tablet' ? (
        <Drawer open={drawerOpen} onClose={closeOverlay} label="Navigation">
          <Sidebar onNavigate={closeOverlay} touch />
        </Drawer>
      ) : null}

      {mode === 'mobile' ? (
        <>
          <div inert={moreOpen}>
            <TabBar moreOpen={moreOpen} onToggleMore={() => toggleOverlay('more')} />
          </div>
          <MoreSheet open={moreOpen} onClose={closeOverlay} />
        </>
      ) : null}

      <RouteAnnouncer />
      <Slot id="global.overlays" />
    </div>
  )
}
