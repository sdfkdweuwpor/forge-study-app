/**
 * Pointer and keyboard input for the world canvas. Pointer events only (mouse, touch and pen).
 *
 * - Drag more than 4 px to pan; anything less is a tap or click.
 * - Hover (mouse) and tap (touch) report the item under the pointer through `emitHover`.
 * - Wheel zooms one integer step towards the cursor; pinching two fingers steps at 1.25 / 0.8.
 * - Keyboard, when the canvas has focus: arrows pan 32 CSS px, `+`/`=` and `-` zoom, `0` fits the view,
 *   Escape clears the tooltip. Enter or Space starts browsing the earned items, and then the arrows
 *   step through them in draw order (the tooltip follows) until Escape or Tab leaves.
 *   Keys with Ctrl, Cmd or Alt are the browser's and are left alone; no other key is prevented.
 */
import { pinchStep, stepItem, type Placed } from '@/logic/world'

export interface Pt {
  x: number
  y: number
}

/** What the input needs from the mounted world. Coordinates are CSS pixels unless it says device pixels. */
export interface InputHost {
  canvas: HTMLCanvasElement
  /** The item at a canvas-relative CSS point, if any. */
  hitAt(css: Pt): Placed | null
  /** Moves the content by `(dx, dy)` CSS pixels, as if dragged. */
  pan(dx: number, dy: number): void
  /** Steps the zoom by one level around a canvas-relative CSS point (the middle when omitted). */
  zoomStep(dir: 1 | -1, around?: Pt): void
  fit(): void
  /** The earned items in draw order. */
  items(): readonly Placed[]
  /** Makes sure an item is on screen (panning the view if it is not) and gives its canvas-relative CSS point. */
  reveal(item: Placed): Pt
  /** Shows or clears the tooltip and the outline. */
  hover(item: Placed | null, at: Pt, via: 'pointer' | 'keyboard'): void
}

export interface InputController {
  /** Stops browsing and forgets pointers; the mount calls it when the model changes under a focused item. */
  reset(): void
  /** The item keyboard browsing is on, if any. */
  browsing(): string | null
  destroy(): void
}

const DRAG_THRESHOLD_PX = 4
const KEY_PAN_PX = 32
/** Wheel distance that makes one zoom step. A mouse notch is about 100; a trackpad sends many small ones. */
const WHEEL_STEP = 60

export function attachInput(host: InputHost): InputController {
  const { canvas } = host

  const pointers = new Map<number, Pt>()
  let primary: { id: number; startX: number; startY: number; lastX: number; lastY: number; type: string } | null = null
  let dragging = false
  let pinchBase = 0
  let wheelAccum = 0
  let wheelAt = 0
  let browseId: string | null = null
  let hovering = false

  /** Canvas-relative CSS point of a client point. */
  const local = (clientX: number, clientY: number): Pt => {
    const r = canvas.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }

  const distance = (): number => {
    const [a, b] = [...pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
  const middle = (): Pt => {
    const [a, b] = [...pointers.values()]
    return a && b ? local((a.x + b.x) / 2, (a.y + b.y) / 2) : { x: 0, y: 0 }
  }

  const showAt = (clientX: number, clientY: number, via: 'pointer' | 'keyboard' = 'pointer'): void => {
    const at = local(clientX, clientY)
    const hit = host.hitAt(at)
    hovering = hit !== null
    host.hover(hit, at, via)
  }

  const clear = (): void => {
    const was = hovering || browseId !== null
    hovering = false
    browseId = null
    if (was) host.hover(null, { x: 0, y: 0 }, 'pointer')
  }

  // ── Pointer ──────────────────────────────────────────────────────────────────────────────────
  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // A pointer that is already gone cannot be captured; dragging simply will not follow it out.
    }
    if (pointers.size === 1) {
      primary = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, type: e.pointerType }
      dragging = false
    } else if (pointers.size === 2) {
      pinchBase = distance()
      dragging = true // a pinch is never a tap
    }
  }

  const onMove = (e: PointerEvent): void => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size >= 2) {
      const step = pinchStep(pinchBase, distance())
      if (step !== 0) {
        host.zoomStep(step, middle())
        pinchBase = distance()
      }
      return
    }
    if (primary && primary.id === e.pointerId) {
      if (!dragging && Math.hypot(e.clientX - primary.startX, e.clientY - primary.startY) > DRAG_THRESHOLD_PX) {
        dragging = true
        clear()
      }
      if (dragging) {
        host.pan(e.clientX - primary.lastX, e.clientY - primary.lastY)
        primary.lastX = e.clientX
        primary.lastY = e.clientY
      }
      return
    }
    // Hover: a mouse with no button down.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      browseId = null
      showAt(e.clientX, e.clientY)
    }
  }

  const release = (e: PointerEvent, cancelled: boolean): void => {
    const was = primary
    pointers.delete(e.pointerId)
    try {
      canvas.releasePointerCapture(e.pointerId)
    } catch {
      // Already released.
    }
    if (pointers.size === 0) {
      if (!cancelled && was && was.id === e.pointerId && !dragging) {
        // A tap or click: touch and pen show the tooltip now (a mouse already showed it on hover).
        browseId = null
        showAt(e.clientX, e.clientY)
      }
      primary = null
      dragging = false
    } else if (pointers.size === 1) {
      const [id, p] = [...pointers.entries()][0] ?? [-1, { x: 0, y: 0 }]
      primary = { id, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, type: was?.type ?? 'touch' }
      dragging = true // the lifted finger of a pinch does not turn into a tap or a jump
    }
  }
  const onUp = (e: PointerEvent): void => release(e, false)
  const onCancel = (e: PointerEvent): void => release(e, true)

  const onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && pointers.size === 0 && browseId === null) clear()
  }

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const now = e.timeStamp
    if (now - wheelAt > 250) wheelAccum = 0
    wheelAt = now
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
    wheelAccum += e.deltaY * unit
    if (Math.abs(wheelAccum) < WHEEL_STEP) return
    const dir: 1 | -1 = wheelAccum < 0 ? 1 : -1
    wheelAccum = 0
    const at = local(e.clientX, e.clientY)
    host.zoomStep(dir, at)
    showAt(e.clientX, e.clientY)
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────────────────────────
  const browse = (delta: number): void => {
    const next = stepItem(host.items(), browseId, delta)
    if (!next) return
    browseId = next.id
    hovering = true
    host.hover(next, host.reveal(next), 'keyboard')
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const arrow = arrows[e.key]
    if (arrow) {
      e.preventDefault()
      if (browseId !== null) browse(arrow[0] + arrow[1])
      // The view moves the way the arrow points, so the content moves the other way.
      else host.pan(-arrow[0] * KEY_PAN_PX, -arrow[1] * KEY_PAN_PX)
      return
    }
    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault()
        host.zoomStep(1)
        break
      case '-':
      case '_':
        e.preventDefault()
        host.zoomStep(-1)
        break
      case '0':
        e.preventDefault()
        host.fit()
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (browseId === null) browse(0)
        else clear()
        break
      case 'Escape':
        if (hovering || browseId !== null) {
          e.preventDefault()
          clear()
        }
        break
      default:
        break
    }
  }

  const onBlur = (): void => {
    if (browseId !== null) clear()
  }

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onCancel)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('keydown', onKey)
  canvas.addEventListener('blur', onBlur)

  return {
    reset() {
      pointers.clear()
      primary = null
      dragging = false
      browseId = null
      hovering = false
    },
    browsing: () => browseId,
    destroy() {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onCancel)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('keydown', onKey)
      canvas.removeEventListener('blur', onBlur)
      pointers.clear()
      primary = null
    },
  }
}
