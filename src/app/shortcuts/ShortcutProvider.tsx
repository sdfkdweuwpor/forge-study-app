import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { isEditableTarget, isMac } from '@/lib/platform'
import { ModalPresenceContext, type PresenceKind } from '@/ui/Modal'
import { useOverlays } from '../providers/OverlayProvider'
import { useRegistry } from '../registry/RegistryContext'
import type { CommandCtx, ScopeId, ShortcutDef } from '../registry/types'
import { ShortcutController, type ScopeOptions } from './controller'

export interface ShortcutContextValue {
  shortcuts: readonly ShortcutDef[]
  /** Active scopes, bottom to top (`global` is implicit and always active). */
  scopes: readonly ScopeId[]
  /** Pushes a scope and returns the function that removes it. Overlay scopes block what is beneath them. */
  pushScope(scope: ScopeId, options?: ScopeOptions): () => void
  bindHandler(id: string, fn: (c: CommandCtx) => void): () => void
  invoke(id: string): void
}

export const ShortcutContext = createContext<ShortcutContextValue | null>(null)

/** Owns the global keydown listener and hands the app the scope stack and handler registry. */
export function ShortcutProvider({ children }: { children: ReactNode }) {
  const { shortcuts } = useRegistry()
  const overlays = useOverlays()
  const controller = useMemo(() => new ShortcutController(isMac()), [])

  const scopes = useSyncExternalStore(
    controller.subscribe,
    controller.getScopes,
    controller.getScopes,
  )

  useEffect(() => {
    controller.setShortcuts(shortcuts)
  }, [controller, shortcuts])

  useEffect(() => {
    controller.setOverlays(overlays)
  }, [controller, overlays])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => controller.handleKeyDown(e, isEditableTarget(e.target))
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      controller.dispose()
    }
  }, [controller])

  const value = useMemo<ShortcutContextValue>(
    () => ({
      shortcuts,
      scopes,
      pushScope: controller.pushScope,
      bindHandler: controller.bindHandler,
      invoke: controller.invoke,
    }),
    [controller, shortcuts, scopes],
  )

  // `ui/Modal`, `Dropdown` and `Popover` cannot import the app, so they report themselves through
  // this hook-in point: a dialog is the `modal` scope, a menu or popover the lighter `menu` scope.
  const announceModal = useCallback(
    (kind: PresenceKind = 'modal') => controller.pushScope(kind),
    [controller],
  )

  return (
    <ShortcutContext.Provider value={value}>
      <ModalPresenceContext.Provider value={announceModal}>
        {children}
      </ModalPresenceContext.Provider>
    </ShortcutContext.Provider>
  )
}
