import { createContext, useContext, useEffect } from 'react'

/** What is announcing itself: a dialog, or a menu / popover that floats over the page. */
export type PresenceKind = 'modal' | 'menu'

/**
 * How an open overlay tells the app about itself. The app provides one function; a `Modal`, `Dropdown`
 * or `Popover` calls it when it opens and calls what it returns when it closes. `ui` knows nothing
 * about shortcuts: the app uses this to push a blocking shortcut scope, so keys meant for the page do
 * not fire while a dialog, a menu or a popover is open. Without a provider (tests, isolated demos) it
 * does nothing.
 */
export type ModalPresence = (kind?: PresenceKind) => () => void

export const ModalPresenceContext = createContext<ModalPresence | null>(null)

/** Announces an open overlay to the app (see `ModalPresence`). */
export function useOverlayPresence(open: boolean, kind: PresenceKind): void {
  const announce = useContext(ModalPresenceContext)
  useEffect(() => (open && announce ? announce(kind) : undefined), [open, announce, kind])
}

/** Announces an open modal to the app. */
export function useModalPresence(open: boolean): void {
  useOverlayPresence(open, 'modal')
}
