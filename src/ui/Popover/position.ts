/**
 * Pure placement maths for anchored overlays (popover, dropdown menu). No DOM access, so it is
 * unit-tested in the Node environment. Coordinates are viewport coordinates (what
 * `getBoundingClientRect()` returns), to be used with `position: fixed`.
 *
 * Order of work: pick a side (flip to the opposite one when the preferred one overflows and the
 * opposite fits), place along the main axis, align on the cross axis, then shift the box back
 * inside the viewport. When neither side fits, the one with more room wins and `maxHeight` tells
 * the caller how tall the box may be before it has to scroll.
 */

export type Side = 'top' | 'bottom' | 'left' | 'right'
export type Align = 'start' | 'center' | 'end'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface PositionOptions {
  anchor: Box
  floating: Size
  viewport: Size
  /** Preferred side. Default `bottom`. */
  side?: Side
  /** Alignment along the anchor's edge. Default `start`. */
  align?: Align
  /** Gap between anchor and floating box. Default 6. */
  offset?: number
  /** Minimum distance to the viewport edge. Default 8. */
  padding?: number
  /** Allow flipping to the opposite side. Default true. */
  flip?: boolean
}

export interface PositionResult {
  x: number
  y: number
  /** The side actually used (after flipping). */
  side: Side
  flipped: boolean
  /** Tallest the box can be without leaving the viewport on the chosen side. */
  maxHeight: number
  /** Transform origin, in px relative to the floating box, pointing at the anchor. */
  origin: { x: number; y: number }
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

const isVertical = (side: Side): boolean => side === 'top' || side === 'bottom'

const clamp = (value: number, min: number, max: number): number =>
  // When the box is larger than the room, the low edge wins so the start of the content stays visible.
  Math.max(min, Math.min(value, max))

/** Free space between the anchor and the viewport edge on `side`, after offset and padding. */
function spaceOn(side: Side, anchor: Box, viewport: Size, offset: number, padding: number): number {
  switch (side) {
    case 'top':
      return anchor.y - offset - padding
    case 'bottom':
      return viewport.height - (anchor.y + anchor.height) - offset - padding
    case 'left':
      return anchor.x - offset - padding
    case 'right':
      return viewport.width - (anchor.x + anchor.width) - offset - padding
  }
}

function alignedStart(align: Align, anchorStart: number, anchorSize: number, size: number): number {
  if (align === 'start') return anchorStart
  if (align === 'end') return anchorStart + anchorSize - size
  return anchorStart + (anchorSize - size) / 2
}

export function computePosition(options: PositionOptions): PositionResult {
  const { anchor, floating, viewport } = options
  const preferred = options.side ?? 'bottom'
  const align = options.align ?? 'start'
  const offset = options.offset ?? 6
  const padding = options.padding ?? 8
  const canFlip = options.flip ?? true

  const need = isVertical(preferred) ? floating.height : floating.width
  const preferredSpace = spaceOn(preferred, anchor, viewport, offset, padding)
  const opposite = OPPOSITE[preferred]
  const oppositeSpace = spaceOn(opposite, anchor, viewport, offset, padding)

  let side = preferred
  if (preferredSpace < need && canFlip) {
    // Flip when the opposite side fits, or when it simply has more room than the preferred one.
    if (oppositeSpace >= need || oppositeSpace > preferredSpace) side = opposite
  }
  const space = Math.max(0, side === preferred ? preferredSpace : oppositeSpace)

  const vertical = isVertical(side)
  // When neither side fits, the box is capped to the room on its side (the caller scrolls it) and
  // placed flush against the anchor. With flip disabled the caller opted out of that: the box keeps
  // its size and is shifted into the viewport instead, even if that overlaps the anchor.
  const capped = vertical && canFlip
  const height = capped ? Math.min(floating.height, space) : floating.height
  const maxHeight = capped ? space : Math.max(0, viewport.height - padding * 2)

  let x: number
  let y: number
  if (vertical) {
    y = side === 'bottom' ? anchor.y + anchor.height + offset : anchor.y - offset - height
    x = alignedStart(align, anchor.x, anchor.width, floating.width)
  } else {
    x = side === 'right' ? anchor.x + anchor.width + offset : anchor.x - offset - floating.width
    y = alignedStart(align, anchor.y, anchor.height, height)
  }

  // Shift back inside the viewport on both axes.
  x = clamp(x, padding, viewport.width - floating.width - padding)
  y = clamp(y, padding, viewport.height - height - padding)

  const anchorCenterX = anchor.x + anchor.width / 2
  const anchorCenterY = anchor.y + anchor.height / 2
  const origin = {
    x:
      side === 'left'
        ? floating.width
        : side === 'right'
          ? 0
          : clamp(anchorCenterX - x, 0, floating.width),
    y: side === 'top' ? height : side === 'bottom' ? 0 : clamp(anchorCenterY - y, 0, height),
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    side,
    flipped: side !== preferred,
    maxHeight: Math.floor(maxHeight),
    origin: { x: Math.round(origin.x), y: Math.round(origin.y) },
  }
}
