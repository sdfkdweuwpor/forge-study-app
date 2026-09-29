/**
 * DOM helpers for the block editor: reading and writing a block's text, and translating between
 * caret positions in the DOM and offsets in the block's plain text.
 *
 * A block's text lives in one contenteditable element whose content is either
 *   - raw (while the block is being edited): a single text node with the plain text, plus a
 *     trailing <br> when the text ends with a newline, so the empty last line stays visible; or
 *   - formatted (while it is not): the same text split into <strong>/<em>/<code>/<a> runs.
 * Both read back the same way: text nodes are text, a <br> is a newline, except a final <br>,
 * which is only the placeholder for a trailing empty line (Chrome makes the same one).
 */
import { parseInline } from '@/logic/blocks'

type Leaf = { node: Text; length: number; br: false } | { node: HTMLBRElement; length: 0 | 1; br: true }

function collectLeaves(root: HTMLElement): Leaf[] {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  )
  const leaves: Leaf[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n instanceof Text) leaves.push({ node: n, length: n.data.length, br: false })
    else if (n instanceof HTMLBRElement) leaves.push({ node: n, length: 1, br: true })
  }
  const last = leaves[leaves.length - 1]
  if (last?.br) last.length = 0
  return leaves
}

/** The plain text of a block element. */
export function readText(root: HTMLElement): string {
  let text = ''
  for (const leaf of collectLeaves(root)) {
    if (leaf.br) text += leaf.length === 1 ? '\n' : ''
    else text += leaf.node.data
  }
  return text
}

/** Offset in the block's text of a DOM position (`node`, `offset`) inside `root`. */
export function textOffset(root: HTMLElement, node: Node, offset: number): number {
  const at = root.ownerDocument.createRange()
  try {
    at.setStart(node, offset)
  } catch {
    return 0
  }
  at.collapse(true)
  let total = 0
  for (const leaf of collectLeaves(root)) {
    if (leaf.br) {
      const parent = leaf.node.parentNode
      if (!parent) continue
      const index = Array.prototype.indexOf.call(parent.childNodes, leaf.node) as number
      if (at.comparePoint(parent, index + 1) > 0) break
      total += leaf.length
      continue
    }
    if (at.comparePoint(leaf.node, leaf.node.data.length) <= 0) {
      total += leaf.length // the position is at or after the end of this run
      continue
    }
    if (at.comparePoint(leaf.node, 0) <= 0) total += node === leaf.node ? offset : 0
    break
  }
  return total
}

interface Position {
  node: Node
  offset: number
}

/** The DOM position for an offset in the block's text (clamped). */
export function positionAt(root: HTMLElement, offset: number): Position {
  let remaining = Math.max(0, offset)
  let last: Position = { node: root, offset: 0 }
  for (const leaf of collectLeaves(root)) {
    if (leaf.br) {
      const parent = leaf.node.parentNode
      if (!parent) continue
      const index = Array.prototype.indexOf.call(parent.childNodes, leaf.node) as number
      if (leaf.length === 0) {
        last = { node: parent, offset: index }
        continue
      }
      remaining -= 1
      last = { node: parent, offset: index + 1 }
      continue
    }
    if (remaining <= leaf.length) return { node: leaf.node, offset: remaining }
    remaining -= leaf.length
    last = { node: leaf.node, offset: leaf.length }
  }
  return last
}

export interface Selected {
  start: number
  end: number
}

/** The selection as offsets in `root`'s text, or null when it is not inside `root`. */
export function getSelectionOffsets(root: HTMLElement): Selected | null {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const start = textOffset(root, range.startContainer, range.startOffset)
  const end = range.collapsed ? start : textOffset(root, range.endContainer, range.endOffset)
  return { start, end }
}

/** Puts the selection at `start..end` (a caret when `end` is omitted). */
export function setSelectionOffsets(root: HTMLElement, start: number, end: number = start): void {
  const selection = root.ownerDocument.getSelection()
  if (!selection) return
  const from = positionAt(root, start)
  const to = end === start ? from : positionAt(root, end)
  const range = root.ownerDocument.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  selection.removeAllRanges()
  selection.addRange(range)
}

// ─── Content ────────────────────────────────────────────────────────────────

/** Replaces the element's content with the raw text (see the file comment for the shape). */
export function writeRaw(root: HTMLElement, text: string): void {
  const doc = root.ownerDocument
  const nodes: Node[] = []
  if (text !== '') nodes.push(doc.createTextNode(text))
  if (text.endsWith('\n')) nodes.push(doc.createElement('br'))
  root.replaceChildren(...nodes)
}

/** Replaces the element's content with the text split into formatted runs. */
export function writeFormatted(root: HTMLElement, text: string): void {
  const doc = root.ownerDocument
  const nodes: Node[] = []
  for (const span of parseInline(text)) {
    let node: Node = doc.createTextNode(span.text)
    const wrap = (tag: 'code' | 'em' | 'strong'): void => {
      const el = doc.createElement(tag)
      el.append(node)
      node = el
    }
    if (span.code) wrap('code')
    if (span.italic) wrap('em')
    if (span.bold) wrap('strong')
    if (span.href !== null) {
      const link = doc.createElement('a')
      link.href = span.href
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.append(node)
      node = link
    }
    nodes.push(node)
  }
  if (text.endsWith('\n')) nodes.push(doc.createElement('br'))
  root.replaceChildren(...nodes)
}

// ─── Geometry ───────────────────────────────────────────────────────────────

/** The viewport rectangle of the caret in `root`, or null when it cannot be measured. */
export function caretRect(root: HTMLElement): DOMRect | null {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0).cloneRange()
  if (!root.contains(range.startContainer)) return null
  range.collapse(true)
  const first = range.getClientRects().item(0)
  if (first && first.height > 0) return first
  const box = range.getBoundingClientRect()
  return box.height > 0 ? box : null
}

/** Scrolls the block into view when the caret has moved out of the visible part of the page. */
export function revealCaret(root: HTMLElement): void {
  const rect = caretRect(root)
  const view = root.ownerDocument.defaultView
  if (!rect || !view) return
  const margin = 24
  if (rect.top < margin || rect.bottom > view.innerHeight - margin) {
    root.scrollIntoView({ block: 'nearest' })
  }
}

interface CaretDocument {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

/** Offset in `root`'s text of the character under the viewport point (x, y), or null. */
export function textOffsetAtPoint(root: HTMLElement, x: number, y: number): number | null {
  const doc: CaretDocument = root.ownerDocument
  let node: Node | null = null
  let offset = 0
  const position = doc.caretPositionFromPoint?.(x, y)
  if (position) {
    node = position.offsetNode
    offset = position.offset
  } else {
    const range = doc.caretRangeFromPoint?.(x, y)
    if (range) {
      node = range.startContainer
      offset = range.startOffset
    }
  }
  if (!node || !root.contains(node)) return null
  return textOffset(root, node, offset)
}

export interface ContentBox {
  top: number
  bottom: number
  lineHeight: number
}

/** The viewport-space content box of `root` and its line height. */
export function contentBox(root: HTMLElement): ContentBox {
  const rect = root.getBoundingClientRect()
  const style = root.ownerDocument.defaultView?.getComputedStyle(root)
  const padTop = parseFloat(style?.paddingTop ?? '0') || 0
  const padBottom = parseFloat(style?.paddingBottom ?? '0') || 0
  const lineHeight = parseFloat(style?.lineHeight ?? '') || 24
  return { top: rect.top + padTop, bottom: rect.bottom - padBottom, lineHeight }
}

/** Where a browser can put `contenteditable="plaintext-only"`, else plain `true`. */
let plaintext: boolean | undefined
export function editableMode(): 'plaintext-only' | 'true' {
  if (plaintext === undefined) {
    if (typeof document === 'undefined') return 'true'
    const probe = document.createElement('div')
    try {
      probe.contentEditable = 'plaintext-only'
    } catch {
      /* older engines throw on an unknown value */
    }
    plaintext = probe.contentEditable === 'plaintext-only'
  }
  return plaintext ? 'plaintext-only' : 'true'
}
