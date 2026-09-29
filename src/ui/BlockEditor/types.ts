import type { ClipboardEvent, KeyboardEvent } from 'react'
import type { ID, SlashCommandId } from '@/logic/blocks'
import type { Selected } from './dom'

/** Where the caret goes when a block takes focus. */
export type FocusTarget =
  /** A text offset (a selection when `end` is given). */
  | { kind: 'offset'; start: number; end?: number }
  /** The character nearest `x` on the block's first or last line: arrowing up or down keeps the column. */
  | { kind: 'point'; x: number; edge: 'first' | 'last' }

/** What a mounted row lets the editor do to it. */
export interface RowHandle {
  focus(target: FocusTarget): void
  /** The focusable element: the text field, or the divider. */
  element(): HTMLElement | null
  /** Selection as text offsets, or null when it is not inside this block. */
  offsets(): Selected | null
}

/** Everything a row reports to the editor. One stable object per editor. */
export interface RowController {
  register(id: ID, handle: RowHandle | null): void
  keyDown(e: KeyboardEvent<HTMLElement>, id: ID): void
  input(id: ID, text: string, caret: number, inputType: string, composing: boolean): void
  compositionStart(): void
  compositionEnd(id: ID, text: string, caret: number): void
  beforeInput(e: InputEvent, id: ID): void
  paste(e: ClipboardEvent<HTMLElement>, id: ID): void
  focused(id: ID): void
  blurred(id: ID): void
  toggleChecked(id: ID, checked: boolean): void
  setEmoji(id: ID, emoji: string): void
  addBelow(id: ID): void
}

/** State of the open slash menu: which block, which part of its text is the `/query`. */
export interface MenuState {
  id: ID
  start: number
  end: number
  query: string
  /** Highlighted option. */
  index: number
}

export type { SlashCommandId }
