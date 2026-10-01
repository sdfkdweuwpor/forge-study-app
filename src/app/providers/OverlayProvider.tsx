import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { OverlayApi, OverlayKind } from '../registry/types'

/**
 * UI state for app-wide overlays (command palette, quick add, shortcut sheet, full-screen focus).
 * This only says which overlay *should* be open. Features render the overlay itself through the
 * `global.overlays` slot and push their own shortcut scope while mounted.
 */

interface OverlayState {
  /** Open overlays, oldest first; Escape closes the last one. */
  open: readonly OverlayKind[]
  api: OverlayApi
}

const OverlayContext = createContext<OverlayState | null>(null)

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<readonly OverlayKind[]>([])

  const openOverlay = useCallback((kind: OverlayKind) => {
    setOpen((cur) => (cur.includes(kind) ? cur : [...cur, kind]))
  }, [])
  const closeOverlay = useCallback((kind: OverlayKind) => {
    setOpen((cur) => (cur.includes(kind) ? cur.filter((k) => k !== kind) : cur))
  }, [])
  const toggle = useCallback((kind: OverlayKind) => {
    setOpen((cur) => (cur.includes(kind) ? cur.filter((k) => k !== kind) : [...cur, kind]))
  }, [])

  const value = useMemo<OverlayState>(
    () => ({
      open,
      api: {
        open: openOverlay,
        close: closeOverlay,
        toggle,
        isOpen: (kind) => open.includes(kind),
      },
    }),
    [open, openOverlay, closeOverlay, toggle],
  )

  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>
}

function useOverlayState(): OverlayState {
  const ctx = useContext(OverlayContext)
  if (!ctx) throw new Error('useOverlays must be used inside <OverlayProvider>')
  return ctx
}

export function useOverlays(): OverlayApi {
  return useOverlayState().api
}

/** Overlays currently open, oldest first. */
export function useOpenOverlays(): readonly OverlayKind[] {
  return useOverlayState().open
}
