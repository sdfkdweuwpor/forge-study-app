import { createContext, useContext, useEffect } from 'react'

/**
 * How an open modal tells the app about itself. The app provides one function; a `Modal` calls it
 * when it opens and calls what it returns when it closes. `ui` knows nothing about shortcuts: the
 * app uses this to push a blocking shortcut scope, so keys meant for the page do not fire while a
 * dialog is open. Without a provider (tests, isolated demos) it does nothing.
 */
export type ModalPresence = () => () => void

export const ModalPresenceContext = createContext<ModalPresence | null>(null)

/** Announces an open modal to the app (see `ModalPresence`). */
export function useModalPresence(open: boolean): void {
  const announce = useContext(ModalPresenceContext)
  useEffect(() => (open && announce ? announce() : undefined), [open, announce])
}
