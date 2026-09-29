import { useContext, useEffect, useRef } from 'react'
import type { CommandCtx, ScopeId } from '../registry/types'
import type { ScopeOptions } from './controller'
import { ShortcutContext, type ShortcutContextValue } from './ShortcutProvider'

export function useShortcuts(): ShortcutContextValue {
  const ctx = useContext(ShortcutContext)
  if (!ctx) throw new Error('Shortcut hooks must be used inside <ShortcutProvider>')
  return ctx
}

/**
 * Push a shortcut scope while the calling component is mounted (and `active`). The top scope wins.
 * Overlay scopes (`modal`, `menu`, `palette`, `fullscreen`, `drawer`) are blocking: while one is open, only
 * its own shortcuts and global ones marked `allowInOverlays` fire. `options.blocking` overrides that.
 */
export function useShortcutScope(scope: ScopeId, active = true, options?: ScopeOptions): void {
  const { pushScope } = useShortcuts()
  const blocking = options?.blocking
  useEffect(
    () => (active ? pushScope(scope, blocking === undefined ? {} : { blocking }) : undefined),
    [pushScope, scope, active, blocking],
  )
}

/**
 * Bind behaviour to a shortcut declared in a manifest (`ShortcutDef` without `run`).
 * The latest mounted handler for an id wins; the def is inert while nothing is bound.
 */
export function useShortcutHandler(
  id: string,
  handler: (c: CommandCtx) => void,
  enabled = true,
): void {
  const { bindHandler } = useShortcuts()
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    if (!enabled) return undefined
    return bindHandler(id, (c) => ref.current(c))
  }, [bindHandler, id, enabled])
}
