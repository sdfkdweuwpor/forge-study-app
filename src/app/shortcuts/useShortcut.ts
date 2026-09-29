import { useContext, useEffect, useRef } from 'react'
import type { CommandCtx, ScopeId } from '../registry/types'
import { ShortcutContext, type ShortcutContextValue } from './ShortcutProvider'

export function useShortcuts(): ShortcutContextValue {
  const ctx = useContext(ShortcutContext)
  if (!ctx) throw new Error('Shortcut hooks must be used inside <ShortcutProvider>')
  return ctx
}

/** Push a shortcut scope while the calling component is mounted (and `active`). The top scope wins. */
export function useShortcutScope(scope: ScopeId, active = true): void {
  const { pushScope } = useShortcuts()
  useEffect(() => (active ? pushScope(scope) : undefined), [pushScope, scope, active])
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
