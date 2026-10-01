/**
 * Places a floating box next to an anchor rect inside the viewport, without a library.
 * Pure (numbers in, numbers out) so it is unit-tested; Tooltip measures and calls it.
 *
 * 1. Main axis: the preferred side if the box fits there, else the opposite side if it fits,
 *    else whichever of the two has more room.
 * 2. Cross axis: centred on the anchor, then clamped so it stays `margin` px from the edges.
 */

export type Side = 'top' | 'bottom' | 'left' | 'right'

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

export interface PlaceOptions {
  side: Side
  /** Distance between anchor and box. */
  gap: number
  /** Minimum distance from the viewport edges. */
  margin: number
  viewport: { width: number; height: number }
}

export interface Placement {
  top: number
  left: number
  side: Side
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

function room(side: Side, a: Box, vw: number, vh: number): number {
  switch (side) {
    case 'top':
      return a.top
    case 'bottom':
      return vh - (a.top + a.height)
    case 'left':
      return a.left
    case 'right':
      return vw - (a.left + a.width)
  }
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), Math.max(min, max))

export function place(
  anchor: Box,
  size: { width: number; height: number },
  { side, gap, margin, viewport }: PlaceOptions,
): Placement {
  const vertical = side === 'top' || side === 'bottom'
  const need = (vertical ? size.height : size.width) + gap + margin
  const { width: vw, height: vh } = viewport

  let chosen = side
  if (room(side, anchor, vw, vh) < need) {
    const other = OPPOSITE[side]
    const otherRoom = room(other, anchor, vw, vh)
    if (otherRoom >= need || otherRoom > room(side, anchor, vw, vh)) chosen = other
  }

  let top: number
  let left: number
  if (vertical) {
    top = chosen === 'top' ? anchor.top - gap - size.height : anchor.top + anchor.height + gap
    left = anchor.left + anchor.width / 2 - size.width / 2
    left = clamp(left, margin, vw - margin - size.width)
  } else {
    left = chosen === 'left' ? anchor.left - gap - size.width : anchor.left + anchor.width + gap
    top = anchor.top + anchor.height / 2 - size.height / 2
    top = clamp(top, margin, vh - margin - size.height)
  }
  return { top: Math.round(top), left: Math.round(left), side: chosen }
}
