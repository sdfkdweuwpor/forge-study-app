/**
 * Pure caret geometry for moving between blocks with the arrow keys. Everything is measured in
 * the same coordinate space (viewport pixels).
 */

export interface CaretGeometry {
  /** Top and bottom edge of the caret. */
  caretTop: number
  caretBottom: number
  /** Top and bottom of the block's content box (padding excluded). */
  contentTop: number
  contentBottom: number
  lineHeight: number
}

export interface LineEdges {
  /** The caret is on the first visual line of the block. */
  first: boolean
  /** The caret is on the last visual line of the block. */
  last: boolean
}

/**
 * Whether the caret is on the first and/or last visual line. A caret sits a few pixels inside its
 * line, so "within 3/4 of a line height of the edge" separates it from the neighbouring line.
 */
export function lineEdges(g: CaretGeometry): LineEdges {
  const line = g.lineHeight > 0 ? g.lineHeight : Math.max(1, g.caretBottom - g.caretTop)
  const reach = line * 0.75
  return { first: g.caretTop - g.contentTop < reach, last: g.contentBottom - g.caretBottom < reach }
}

/** The same question answered from the text alone (hard newlines; soft wraps are not seen). */
export function lineEdgesFromText(text: string, caret: number): LineEdges {
  const at = Math.min(Math.max(0, caret), text.length)
  return { first: !text.slice(0, at).includes('\n'), last: !text.slice(at).includes('\n') }
}

/** The y coordinate in the middle of the first or last line of a content box. */
export function lineCenterY(
  box: { top: number; bottom: number; lineHeight: number },
  edge: 'first' | 'last',
): number {
  const half = box.lineHeight / 2
  return edge === 'first' ? box.top + half : box.bottom - half
}
