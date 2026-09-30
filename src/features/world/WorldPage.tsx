/**
 * `/world`: My World (BRIEF §5.6), an isometric pixel city that grows as work gets finished. A slim
 * header (title, a stats line, the toolbar) over a canvas that fills the rest of the content area. The
 * engine (`./engine`) owns the canvas; this page owns everything around it: loading, the empty and error
 * states, the tooltip, the toolbar, the legend, the shortcuts and the PNG download.
 */
import { CircleAlert, Download, Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { BREAKPOINTS, useMediaQuery } from '@/app/hooks/useMediaQuery'
import { useToday } from '@/app/hooks/useToday'
import { useTheme } from '@/app/providers/ThemeProvider'
import { recordError } from '@/app/reportError'
import { Link } from '@/app/router'
import { useShortcutHandler, useShortcutScope } from '@/app/shortcuts'
import { downloadBlob } from '@/lib/download'
import { describeWorld, statsLine, tooltipText, type Placed, type WorldModel } from '@/logic/world'
import { Button, EmptyState, IconButton, Skeleton, useToast } from '@/ui'
import { mountWorld, type WorldHandle } from './engine/mount'
import { LegendPopover } from './LegendPopover'
import { useWorldModel } from './queries'
import { WorldTooltip, type TipState } from './WorldTooltip'
import styles from './WorldPage.module.css'

/** The name a screen reader gets for the canvas. */
const CANVAS_LABEL = 'Your city. Use arrow keys to pan, plus and minus to zoom.'

/** Test hook: with the sample-data build (`?seed=`), e2e specs can ask where an item is drawn. */
declare global {
  interface Window {
    __forgeWorld?: {
      pointOf(id: string): { x: number; y: number } | null
      ids(): string[]
      stats(): WorldModel['stats'] | null
    }
  }
}

/**
 * What the mounted engine looks like to the page: its handle (once mounted) and whether the browser could
 * not draw at all. Kept in a tiny external store so mounting and unmounting, which happen inside an effect,
 * reach the toolbar without setting state from the effect body.
 */
interface Mounted {
  handle: WorldHandle | null
  failed: boolean
}

function createMountStore() {
  let value: Mounted = { handle: null, failed: false }
  const listeners = new Set<() => void>()
  return {
    get: (): Mounted => value,
    set(next: Mounted) {
      value = next
      listeners.forEach((l) => l())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

function Header({ model, children }: { model?: WorldModel; children?: React.ReactNode }) {
  return (
    <header className={styles.header}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>My World</h1>
        {model && (
          <p className={styles.stats} data-testid="world-stats">
            {statsLine(model.stats)}
          </p>
        )}
      </div>
      {children}
    </header>
  )
}

function WorldBody() {
  const today = useToday()
  const { resolvedTheme, reducedMotion } = useTheme()
  const toast = useToast()
  // Below tablet width the toolbar keeps to one row: the wordy buttons become icons.
  const roomy = useMediaQuery(BREAKPOINTS.tablet)
  const model = useWorldModel(today)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [store] = useState(createMountStore)
  const { handle: mountedHandle, failed: drawFailed } = useSyncExternalStore(store.subscribe, store.get)
  const ready = mountedHandle !== null
  const [tip, setTip] = useState<TipState | null>(null)
  const [exporting, setExporting] = useState(false)

  // The engine is mounted once, when there is a model, and told about later changes below. The latest
  // values are read through refs so that mounting does not depend on them.
  const latest = useRef({ model, resolvedTheme, reducedMotion })
  useEffect(() => {
    latest.current = { model, resolvedTheme, reducedMotion }
  })
  const hasModel = model !== undefined

  useEffect(() => {
    const canvas = canvasRef.current
    const first = latest.current.model
    if (!hasModel || !canvas || !first) return undefined
    let handle: WorldHandle
    try {
      handle = mountWorld(canvas, first, {
        theme: latest.current.resolvedTheme,
        reducedMotion: latest.current.reducedMotion,
        now: Date.now,
        onHover: (item, at, via = 'pointer') => setTip(item ? { item, x: at.x, y: at.y, via } : null),
      })
    } catch (e) {
      recordError(e, 'world.mount')
      store.set({ handle: null, failed: true })
      return undefined
    }
    store.set({ handle, failed: false })
    const observer = new ResizeObserver(() => handle.resize())
    observer.observe(canvas)
    if (import.meta.env.VITE_ENABLE_SEED === '1') {
      window.__forgeWorld = {
        pointOf: (id) => handle.clientPointOf(id),
        ids: () => latest.current.model?.earned.map((p) => p.id) ?? [],
        stats: () => latest.current.model?.stats ?? null,
      }
    }
    return () => {
      observer.disconnect()
      handle.destroy()
      store.set({ handle: null, failed: false })
      if (import.meta.env.VITE_ENABLE_SEED === '1') delete window.__forgeWorld
    }
  }, [hasModel, store])

  useEffect(() => {
    if (model) mountedHandle?.update(model)
  }, [model, mountedHandle])
  useEffect(() => {
    mountedHandle?.setTheme(resolvedTheme)
  }, [resolvedTheme, mountedHandle])
  useEffect(() => {
    mountedHandle?.setReducedMotion(reducedMotion)
  }, [reducedMotion, mountedHandle])

  const zoomBy = useCallback(
    (delta: number) => {
      if (mountedHandle) mountedHandle.zoomTo(mountedHandle.zoom() + delta)
    },
    [mountedHandle],
  )
  const fit = useCallback(() => mountedHandle?.fit(), [mountedHandle])
  const exportPng = useCallback(async () => {
    const h = mountedHandle
    if (!h || exporting) return
    setExporting(true)
    try {
      downloadBlob(`forge-world-${today}.png`, await h.exportPng())
    } catch (e) {
      recordError(e, 'world.export')
      toast.error('Could not save your world', { description: 'Try again in a moment.' })
    } finally {
      setExporting(false)
    }
  }, [mountedHandle, exporting, today, toast])

  useShortcutHandler('world.zoomIn', () => zoomBy(1), ready)
  useShortcutHandler('world.zoomOut', () => zoomBy(-1), ready)
  useShortcutHandler('world.fit', fit, ready)
  useShortcutHandler('world.export', () => void exportPng(), ready)

  const isEmpty = model !== undefined && model.earned.length === 0
  const description = model ? describeWorld(model.stats) : 'Loading your city.'
  const spoken = tip?.via === 'keyboard' ? spokenTip(tip.item) : ''

  return (
    <>
      <Header model={model}>
        <div className={styles.toolbar} role="group" aria-label="World view">
          <IconButton label="Zoom out" icon={<ZoomOut />} shortcut="-" disabled={!ready} onClick={() => zoomBy(-1)} />
          <IconButton label="Zoom in" icon={<ZoomIn />} shortcut="=" disabled={!ready} onClick={() => zoomBy(1)} />
          {roomy ? (
            <Button variant="ghost" size="sm" iconLeft={<Maximize />} disabled={!ready} onClick={fit}>
              Fit
            </Button>
          ) : (
            <IconButton label="Fit to view" icon={<Maximize />} shortcut="0" disabled={!ready} onClick={fit} />
          )}
          <span className={styles.divider} aria-hidden="true" />
          <LegendPopover compact={!roomy} />
          {roomy ? (
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Download />}
              loading={exporting}
              disabled={!ready}
              onClick={() => void exportPng()}
            >
              Export PNG
            </Button>
          ) : (
            <IconButton
              label="Export PNG"
              icon={<Download />}
              variant="secondary"
              disabled={!ready || exporting}
              onClick={() => void exportPng()}
            />
          )}
        </div>
      </Header>

      <div className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          tabIndex={0}
          aria-label={CANVAS_LABEL}
          aria-describedby="world-description"
          data-testid="world-canvas"
        />
        <p id="world-description" className="sr-only">
          {description} Press Enter to step through what you have built.
        </p>
        <p className="sr-only" aria-live="polite">
          {spoken}
        </p>

        {tip && <WorldTooltip tip={tip} />}

        {model === undefined && !drawFailed && (
          <div className={styles.loading} role="status" aria-busy="true" aria-label="Loading your city">
            <Skeleton variant="block" width="100%" height="100%" />
          </div>
        )}

        {isEmpty && !drawFailed && (
          <div className={styles.empty} data-testid="world-empty">
            <EmptyState
              size="sm"
              titleAs="h2"
              title="Your city starts with one plot"
              description="Finish a task to lay your first stone."
              action={
                <Link to="today" className={styles.emptyLink}>
                  Go to Today
                </Link>
              }
            />
          </div>
        )}

        {drawFailed && (
          <div className={styles.fallback}>
            <EmptyState
              titleAs="h2"
              icon={<CircleAlert />}
              title="Your browser can’t draw the world"
              description="Everything you have finished is safe; the city just needs a browser with canvas support."
            />
          </div>
        )}
      </div>
    </>
  )
}

function spokenTip(item: Placed): string {
  const t = tooltipText(item)
  return [t.title, t.detail, t.date].filter((s) => s !== '').join('. ')
}

export default function WorldPage() {
  useShortcutScope('world')
  return (
    <div className={styles.page} data-testid="world-page">
      <ErrorBoundary
        fallback={(_error, reset) => (
          <>
            <Header />
            <div className={styles.fallback}>
              <EmptyState
                titleAs="h2"
                icon={<CircleAlert />}
                title="Couldn’t load your city"
                description="Your data is safe on this device. Try again, or reload the page."
                action={
                  <Button variant="secondary" onClick={reset}>
                    Try again
                  </Button>
                }
              />
            </div>
          </>
        )}
      >
        <WorldBody />
      </ErrorBoundary>
    </div>
  )
}
