import { useCallback, useEffect, useRef } from 'react'

/**
 * Escape handling for stacked overlays. One document listener sends Escape to the topmost open
 * layer only, so Esc closes a dropdown inside a modal first, then the modal. A layer whose owner
 * ignores Escape (a modal with `closeOnEsc={false}`) still registers, so layers below it stay open.
 *
 * The listener runs in the bubble phase after React handlers: a component that handles Escape
 * itself (and calls `preventDefault`) wins. Escape is then consumed, so the app-wide shortcut
 * handler does not also act on it.
 */

interface Layer {
  onEscape: () => void
}

const stack: Layer[] = []

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
  const top = stack[stack.length - 1]
  if (!top) return
  e.preventDefault()
  e.stopPropagation()
  top.onEscape()
}

function register(layer: Layer): () => void {
  if (stack.length === 0) document.addEventListener('keydown', onKeyDown)
  stack.push(layer)
  return () => {
    const index = stack.indexOf(layer)
    if (index !== -1) stack.splice(index, 1)
    if (stack.length === 0) document.removeEventListener('keydown', onKeyDown)
  }
}

/**
 * Registers an overlay while `active`. `onEscape` may change between renders. Returns `isTop()`,
 * which says whether this overlay is currently the topmost one (a modal's focus trap only acts then).
 */
export function useLayer(active: boolean, onEscape: () => void): () => boolean {
  const handler = useRef(onEscape)
  const layerRef = useRef<Layer | null>(null)
  useEffect(() => {
    handler.current = onEscape
  })
  useEffect(() => {
    if (!active) return undefined
    const layer: Layer = { onEscape: () => handler.current() }
    layerRef.current = layer
    const unregister = register(layer)
    return () => {
      unregister()
      layerRef.current = null
    }
  }, [active])
  return useCallback(() => {
    const layer = layerRef.current
    return layer !== null && stack[stack.length - 1] === layer
  }, [])
}
