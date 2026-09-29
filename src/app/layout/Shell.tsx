import { PanelLeft } from 'lucide-react'
import { useCallback, useState, type CSSProperties } from 'react'
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
import styles from './Shell.module.css'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { keyHint } from './nav'

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
  // Overlay open-state is keyed to the route and breakpoint it was opened on, so it closes by itself
  // when either changes (no effect needed).
  const overlayKey = `${pathname}|${mode}`
  const [drawerKey, setDrawerKey] = useState<string | null>(null)
  const [moreKey, setMoreKey] = useState<string | null>(null)
  const drawerOpen = drawerKey === overlayKey
  const moreOpen = moreKey === overlayKey

  const closeDrawer = useCallback(() => setDrawerKey(null), [])
  const closeMore = useCallback(() => setMoreKey(null), [])

  const toggleSidebar = useCallback(() => {
    if (mode === 'desktop') {
      setCollapsed((c) => {
        writeBoolPref(PREF_KEYS.sidebarCollapsed, !c)
        return !c
      })
    } else if (mode === 'tablet') {
      setDrawerKey((k) => (k === overlayKey ? null : overlayKey))
    }
  }, [mode, overlayKey])
  useShortcutHandler('app.toggleSidebar', toggleSidebar)

  const commitWidth = (px: number) => {
    setWidth(px)
    setResizing(false)
    writePref(PREF_KEYS.sidebarWidth, String(px))
  }

  const sidebarHidden = mode === 'desktop' && collapsed
  const showOpenButton = sidebarHidden || mode === 'tablet'
  const overlayOpen = drawerOpen || moreOpen

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
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        Skip to content
      </a>

      {mode === 'desktop' ? (
        <div
          className={styles.sidebarWrap}
          data-collapsed={collapsed || undefined}
          inert={collapsed}
        >
          <div className={styles.sidebarInner}>
            <Sidebar onCollapse={toggleSidebar} />
          </div>
          <Resizer
            width={width}
            dragging={resizing}
            onDragStart={() => setResizing(true)}
            onDrag={setWidth}
            onCommit={commitWidth}
          />
        </div>
      ) : null}

      <div className={styles.content} inert={overlayOpen}>
        {showOpenButton ? (
          <button
            type="button"
            className={styles.openButton}
            onClick={toggleSidebar}
            aria-label="Open sidebar"
            aria-expanded={mode === 'tablet' ? drawerOpen : !collapsed}
            title={`Open sidebar  ${keyHint('mod+\\')}`}
          >
            <PanelLeft size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
        <main id="main" tabIndex={-1} className={styles.main}>
          <div className={styles.pageOuter}>
            <div className={styles.page} key={route.name}>
              <RouteView />
            </div>
          </div>
        </main>
      </div>

      {mode === 'desktop' ? <RightPanel /> : null}

      {mode === 'tablet' ? (
        <Drawer open={drawerOpen} onClose={closeDrawer} label="Navigation">
          <Sidebar onNavigate={closeDrawer} touch />
        </Drawer>
      ) : null}

      {mode === 'mobile' ? (
        <>
          <div inert={moreOpen}>
            <TabBar
              moreOpen={moreOpen}
              onToggleMore={() => setMoreKey((k) => (k === overlayKey ? null : overlayKey))}
            />
          </div>
          <MoreSheet open={moreOpen} onClose={closeMore} />
        </>
      ) : null}

      <Slot id="global.overlays" />
    </div>
  )
}
