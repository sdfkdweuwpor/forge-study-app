import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import { newId } from '@/lib/ids'
import {
  applyMarkdownShortcut,
  applySlashAt,
  backspaceAtStart,
  deleteAtEnd,
  filterSlash,
  markdownShortcut,
  moveBlockToIndex,
  pasteText,
  removeBlock,
  replaceRange,
  setBlockChecked,
  setBlockEmoji,
  setBlockText,
  slashContext,
  splitAtSelection,
  splitBlock,
  toggleInlineMarker,
  type Block,
  type BlockEdit,
  type ID,
  type InlineMarker,
  type SlashCommandId,
} from '@/logic/blocks'
import { caretRect, contentBox, type Selected } from './dom'
import { lineEdges, lineEdgesFromText } from './geometry'
import {
  caretAfterRestore,
  emptyHistory,
  record,
  redo,
  undo,
  type History,
  type Snapshot,
} from './history'
import { edited, initialModel, reconcile } from './model'
import type { FocusTarget, MenuState, RowController, RowHandle } from './types'

const MARKERS: Readonly<Record<string, InlineMarker>> = { b: '**', i: '*', e: '`' }

interface FocusRequest {
  id: ID
  target: FocusTarget
}

interface Options {
  value: readonly Block[]
  onChange: ((blocks: Block[]) => void) | undefined
  readOnly: boolean
}

export interface BlockEditorState {
  /** What to render: `value`, or one empty paragraph when that is empty. */
  doc: readonly Block[]
  ctrl: EditorController
  menu: MenuState | null
  /** Block that holds the editor's single tab stop. */
  currentId: ID | null
}

export interface EditorController extends RowController {
  chooseSlash(command: SlashCommandId): void
  hoverSlash(index: number): void
  /** Closes the menu when the caret has left its `/query`. */
  checkMenu(): void
  menuAnchor(): DOMRect | null
  menuField(): HTMLElement | null
  reorder(id: ID, overId: ID): void
  focusEnd(): void
  undo(): void
  redo(): void
}

/**
 * The editor's brain: the document, its history, what the keys do, the slash menu, and where the
 * caret goes after every change. Rows are dumb: they render a block and report events here.
 *
 * `value` is the truth from outside; the editor keeps its own copy so typing never waits for the
 * parent. A new `value` replaces the copy unless it is one of the editor's own recent states (the
 * parent handing an edit back, possibly late, after a debounced save).
 */
export function useBlockEditor({ value, onChange, readOnly }: Options): BlockEditorState {
  const [virtualId] = useState<ID>(() => newId())
  const [model, setModel] = useState(() => initialModel(value))
  const [menu, setMenuState] = useState<MenuState | null>(null)
  const [activeId, setActiveId] = useState<ID | null>(null)

  const reconciled = reconcile(model, value)
  if (reconciled !== model) setModel(reconciled)

  const doc = useMemo<readonly Block[]>(
    () => (model.doc.length > 0 ? model.doc : [{ id: virtualId, type: 'p', text: '' }]),
    [model.doc, virtualId],
  )

  const docRef = useRef<readonly Block[]>(doc)
  const menuRef = useRef<MenuState | null>(null)
  const onChangeRef = useRef(onChange)
  const readOnlyRef = useRef(readOnly)
  const epochRef = useRef(model.epoch)
  const historyRef = useRef<{ h: History; epoch: number }>({ h: emptyHistory, epoch: model.epoch })
  const focusRequest = useRef<FocusRequest | null>(null)
  const handles = useRef(new Map<ID, RowHandle>())
  const composing = useRef(false)

  useLayoutEffect(() => {
    docRef.current = doc
    onChangeRef.current = onChange
    readOnlyRef.current = readOnly
    epochRef.current = model.epoch
  })

  // Runs after every row's own layout effect, so a block created by the edit is mounted, has its
  // text and is registered by the time the caret is placed.
  useLayoutEffect(() => {
    const request = focusRequest.current
    if (!request) return
    focusRequest.current = null
    handles.current.get(request.id)?.focus(request.target)
  })

  const ctrl = useMemo<EditorController>(() => {
    // ── Document ────────────────────────────────────────────────────────────────────────────

    const showMenu = (next: MenuState | null): void => {
      menuRef.current = next
      setMenuState(next)
    }

    const snapshot = (from: readonly Block[]): Snapshot => {
      const active = document.activeElement
      const holder =
        active instanceof HTMLElement ? active.closest<HTMLElement>('[data-block-id]') : null
      const focusId = holder?.dataset.blockId ?? null
      const selected = focusId ? handles.current.get(focusId)?.offsets() : null
      return { doc: from, focusId, caret: selected?.start ?? 0 }
    }

    const commit = (next: Block[], focus?: FocusRequest, keepMenu = false): void => {
      docRef.current = next
      if (focus) focusRequest.current = focus
      // Any change the menu did not cause itself (typing keeps it open) closes it.
      if (!keepMenu && menuRef.current) showMenu(null)
      setModel((m) => edited(m, next))
      onChangeRef.current?.(next)
    }

    const apply = (
      next: Block[],
      options: { key?: string; focus?: FocusRequest; keepMenu?: boolean } = {},
    ): void => {
      const state = historyRef.current
      if (state.epoch !== epochRef.current) {
        state.h = emptyHistory
        state.epoch = epochRef.current
      }
      state.h = record(state.h, snapshot(docRef.current), options.key ?? null, performance.now())
      commit(next, options.focus, options.keepMenu)
    }

    const at = (id: ID, start: number, end?: number): FocusRequest => ({
      id,
      target: { kind: 'offset', start, end },
    })

    const applyEdit = (edit: BlockEdit, key?: string): void =>
      apply(edit.doc, { focus: at(edit.focusId, edit.caret), key })

    const restore = (step: { snapshot: Snapshot; history: History }, useSnapshotCaret: boolean) => {
      historyRef.current.h = step.history
      const caret = useSnapshotCaret
        ? { focusId: step.snapshot.focusId, caret: step.snapshot.caret }
        : caretAfterRestore(step.snapshot, docRef.current)
      const next = [...step.snapshot.doc]
      const focusId = caret.focusId ?? next[0]?.id
      commit(next, focusId ? at(focusId, caret.caret) : undefined)
    }

    const undoStep = (): void => {
      const state = historyRef.current
      if (state.epoch !== epochRef.current) return
      const step = undo(state.h, snapshot(docRef.current))
      if (step) restore(step, false)
    }

    const redoStep = (): void => {
      const state = historyRef.current
      if (state.epoch !== epochRef.current) return
      const step = redo(state.h, snapshot(docRef.current))
      if (step) restore(step, true)
    }

    // ── Slash menu ──────────────────────────────────────────────────────────────────────────

    const chooseSlash = (command: SlashCommandId): void => {
      const m = menuRef.current
      if (!m) return
      showMenu(null)
      applyEdit(applySlashAt(docRef.current, m.id, command, { start: m.start, end: m.end }, newId))
    }

    /** Opens, updates or closes the menu after the text changed to `text` with the caret at `caret`. */
    const syncMenu = (id: ID, text: string, caret: number, typedSlash: boolean): void => {
      const context = slashContext(text, caret)
      const open = menuRef.current
      if (!context || filterSlash(context.query).length === 0) {
        if (open) showMenu(null)
        return
      }
      if (open && open.id === id && open.start === context.start) {
        showMenu({
          ...open,
          end: context.end,
          query: context.query,
          index: context.query === open.query ? open.index : 0,
        })
      } else if (typedSlash && context.query === '') {
        showMenu({ id, start: context.start, end: context.end, query: '', index: 0 })
      } else if (open) {
        showMenu(null)
      }
    }

    // ── Keys ────────────────────────────────────────────────────────────────────────────────

    const neighbour = (id: ID, direction: -1 | 1): Block | undefined => {
      const list = docRef.current
      const index = list.findIndex((b) => b.id === id)
      return index === -1 ? undefined : list[index + direction]
    }

    const goTo = (target: Block | undefined, focus: FocusTarget): boolean => {
      const handle = target ? handles.current.get(target.id) : undefined
      if (!handle) return false
      handle.focus(focus)
      return true
    }

    const enter = (id: ID, shift: boolean): void => {
      const block = docRef.current.find((b) => b.id === id)
      const selected = handles.current.get(id)?.offsets()
      if (!block || !selected) return
      if (shift) {
        const inserted = replaceRange(block.text, selected.start, selected.end, '\n')
        apply(setBlockText(docRef.current, id, inserted.text), {
          focus: at(id, inserted.caret),
        })
        return
      }
      applyEdit(splitAtSelection(docRef.current, id, selected.start, selected.end, newId))
    }

    const moveBy = (id: ID, delta: -1 | 1, selected: Selected | null): void => {
      const list = docRef.current
      const index = list.findIndex((b) => b.id === id)
      const to = index + delta
      if (index === -1 || to < 0 || to >= list.length) return
      apply(moveBlockToIndex(list, id, to), {
        focus: at(id, selected?.start ?? 0, selected?.end),
      })
    }

    const dividerKey = (e: KeyboardEvent<HTMLElement>, block: Block): void => {
      const mod = e.metaKey || e.ctrlKey
      switch (e.key) {
        case 'Enter':
          if (mod || e.shiftKey || e.altKey) return
          e.preventDefault()
          applyEdit(splitBlock(docRef.current, block.id, 0, newId))
          return
        case 'Backspace':
        case 'Delete':
          e.preventDefault()
          applyEdit(removeBlock(docRef.current, block.id, newId))
          return
        case 'ArrowUp':
        case 'ArrowDown': {
          if (e.shiftKey || mod) return
          const up = e.key === 'ArrowUp'
          e.preventDefault()
          if (e.altKey) {
            moveBy(block.id, up ? -1 : 1, null)
            return
          }
          const target = neighbour(block.id, up ? -1 : 1)
          goTo(target, { kind: 'offset', start: up ? (target?.text.length ?? 0) : 0 })
          return
        }
        default:
      }
    }

    const keyDown = (e: KeyboardEvent<HTMLElement>, id: ID): void => {
      if (readOnlyRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return
      const list = docRef.current
      const block = list.find((b) => b.id === id)
      if (!block) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key
      const lower = key.toLowerCase()

      const open = menuRef.current
      if (open && open.id === id) {
        const items = filterSlash(open.query)
        if (key === 'ArrowDown' || key === 'ArrowUp') {
          e.preventDefault()
          const step = key === 'ArrowDown' ? 1 : -1
          const n = items.length
          if (n > 0) showMenu({ ...open, index: (open.index + step + n) % n })
          return
        }
        if ((key === 'Enter' || key === 'Tab') && !mod && !e.altKey && !e.shiftKey) {
          const chosen = items[open.index]
          if (chosen) {
            e.preventDefault()
            chooseSlash(chosen.id)
            return
          }
        }
        if (key === 'Escape') {
          e.preventDefault()
          showMenu(null)
          return
        }
      }

      // Tab is left alone so it moves focus on to the next control (an editor that swallowed it
      // would be a keyboard trap, WCAG 2.1.2). Esc also leaves and hands focus back to the page.
      if (key === 'Tab') return
      if (key === 'Escape') {
        e.currentTarget.blur()
        return
      }
      if (mod && !e.altKey && (lower === 'z' || lower === 'y')) {
        e.preventDefault()
        if (lower === 'y' || e.shiftKey) redoStep()
        else undoStep()
        return
      }
      if (block.type === 'divider') {
        dividerKey(e, block)
        return
      }

      const selected = handles.current.get(id)?.offsets()
      if (!selected) return

      switch (key) {
        case 'Enter':
          if (mod && e.shiftKey && block.type === 'todo') {
            e.preventDefault()
            apply(setBlockChecked(list, id, !(block.checked ?? false)), {
              focus: at(id, selected.start, selected.end),
            })
            return
          }
          if (mod || e.altKey) return // Mod+Enter belongs to the app (quick add)
          e.preventDefault()
          enter(id, e.shiftKey)
          return

        case 'Backspace': {
          if (selected.start !== 0 || selected.end !== 0 || mod || e.altKey) return
          e.preventDefault()
          const edit = backspaceAtStart(list, id, newId)
          if (edit) applyEdit(edit)
          return
        }

        case 'Delete': {
          if (selected.start !== block.text.length || selected.end !== selected.start) return
          if (mod || e.altKey) return
          const edit = deleteAtEnd(list, id, newId)
          if (edit) {
            e.preventDefault()
            applyEdit(edit)
          }
          return
        }

        case 'ArrowUp':
        case 'ArrowDown': {
          if (e.shiftKey || mod) return
          const up = key === 'ArrowUp'
          if (e.altKey) {
            e.preventDefault()
            moveBy(id, up ? -1 : 1, selected)
            return
          }
          if (selected.start !== selected.end) return
          const element = handles.current.get(id)?.element()
          if (!element) return
          const rect = caretRect(element)
          const box = contentBox(element)
          const edges = rect
            ? lineEdges({
                caretTop: rect.top,
                caretBottom: rect.bottom,
                contentTop: box.top,
                contentBottom: box.bottom,
                lineHeight: box.lineHeight,
              })
            : lineEdgesFromText(block.text, selected.start)
          if (!(up ? edges.first : edges.last)) return
          const target = neighbour(id, up ? -1 : 1)
          if (!target) return
          e.preventDefault()
          goTo(target, {
            kind: 'point',
            x: rect?.left ?? element.getBoundingClientRect().left,
            edge: up ? 'last' : 'first',
          })
          return
        }

        case 'ArrowLeft':
        case 'ArrowRight': {
          if (e.shiftKey || mod || e.altKey || selected.start !== selected.end) return
          const back = key === 'ArrowLeft'
          if (selected.start !== (back ? 0 : block.text.length)) return
          const target = neighbour(id, back ? -1 : 1)
          if (!target) return
          e.preventDefault()
          goTo(target, { kind: 'offset', start: back ? target.text.length : 0 })
          return
        }

        default: {
          const marker = MARKERS[lower]
          if (!marker || !mod || e.altKey || e.shiftKey) return
          e.preventDefault()
          const edit = toggleInlineMarker(block.text, selected.start, selected.end, marker)
          apply(setBlockText(list, id, edit.text), { focus: at(id, edit.start, edit.end) })
        }
      }
    }

    // ── Text ────────────────────────────────────────────────────────────────────────────────

    const input = (
      id: ID,
      text: string,
      caret: number,
      inputType: string,
      isComposing: boolean,
    ): void => {
      if (readOnlyRef.current) return
      const list = docRef.current
      const block = list.find((b) => b.id === id)
      if (!block || block.text === text) return
      const next = setBlockText(list, id, text)
      const key = `${inputType.startsWith('delete') ? 'del' : 'ins'}:${id}`
      if (isComposing || composing.current) {
        apply(next, { key, keepMenu: true })
        return
      }
      const typed = inputType === 'insertText'
      // Markdown converts paragraphs and list items (a heading or callout keeps what is typed).
      if (typed && (block.type === 'p' || block.type === 'bullet' || block.type === 'todo')) {
        const shortcut = markdownShortcut(text, caret)
        if (shortcut && shortcut.type !== block.type) {
          showMenu(null)
          applyEdit(applyMarkdownShortcut(next, id, shortcut, newId))
          return
        }
      }
      apply(next, { key, keepMenu: true })
      syncMenu(id, text, caret, typed && text.charAt(caret - 1) === '/')
    }

    const paste = (e: ClipboardEvent<HTMLElement>, id: ID): void => {
      e.preventDefault()
      const text = e.clipboardData.getData('text/plain')
      const selected = handles.current.get(id)?.offsets()
      if (!text || !selected) return
      showMenu(null)
      applyEdit(pasteText(docRef.current, id, selected.start, selected.end, text, newId))
    }

    const beforeInput = (e: InputEvent, id: ID): void => {
      if (readOnlyRef.current) return
      switch (e.inputType) {
        // Soft keyboards send Enter here rather than as a keydown.
        case 'insertParagraph':
        case 'insertLineBreak':
          if (e.isComposing || composing.current) return
          e.preventDefault()
          enter(id, e.inputType === 'insertLineBreak')
          return
        // The browser's own undo cannot span blocks; ours can.
        case 'historyUndo':
          e.preventDefault()
          undoStep()
          return
        case 'historyRedo':
          e.preventDefault()
          redoStep()
          return
        default:
          if (e.inputType.startsWith('format')) e.preventDefault()
      }
    }

    // ── Rows ────────────────────────────────────────────────────────────────────────────────

    return {
      register: (id, handle) => {
        if (handle) handles.current.set(id, handle)
        else handles.current.delete(id)
      },
      keyDown,
      input,
      paste,
      beforeInput,
      compositionStart: () => {
        composing.current = true
      },
      compositionEnd: (id, text, caret) => {
        composing.current = false
        if (!readOnlyRef.current) syncMenu(id, text, caret, false)
      },
      focused: (id) => {
        const block = docRef.current.find((b) => b.id === id)
        if (block && block.type !== 'divider') setActiveId(id)
      },
      blurred: (id) => {
        if (menuRef.current?.id === id) showMenu(null)
      },
      toggleChecked: (id, checked) => {
        if (!readOnlyRef.current) apply(setBlockChecked(docRef.current, id, checked))
      },
      setEmoji: (id, emoji) => {
        const block = docRef.current.find((b) => b.id === id)
        if (readOnlyRef.current || !block) return
        // The picker took focus; the caret goes back to the end of the callout's text.
        apply(setBlockEmoji(docRef.current, id, emoji), { focus: at(id, block.text.length) })
      },
      addBelow: (id) => {
        const list = docRef.current
        const index = list.findIndex((b) => b.id === id)
        if (readOnlyRef.current || index === -1) return
        const created: Block = { id: newId(), type: 'p', text: '/' }
        apply([...list.slice(0, index + 1), created, ...list.slice(index + 1)], {
          focus: at(created.id, 1),
        })
        showMenu({ id: created.id, start: 0, end: 1, query: '', index: 0 })
      },
      chooseSlash,
      checkMenu: () => {
        const open = menuRef.current
        const selected = open ? handles.current.get(open.id)?.offsets() : null
        // Caret moved out of the `/query` (arrow keys, a click): the menu has nothing to do. When
        // the selection is elsewhere entirely, the block's blur closes it.
        if (open && selected) {
          const inside = selected.start === selected.end && selected.start > open.start
          if (!inside || selected.start > open.end) showMenu(null)
        }
      },
      hoverSlash: (index) => {
        const open = menuRef.current
        if (open) showMenu({ ...open, index })
      },
      menuAnchor: () => {
        const open = menuRef.current
        const element = open ? handles.current.get(open.id)?.element() : null
        return element ? (caretRect(element) ?? element.getBoundingClientRect()) : null
      },
      menuField: () => {
        const open = menuRef.current
        return open ? (handles.current.get(open.id)?.element() ?? null) : null
      },
      reorder: (id, overId) => {
        const list = docRef.current
        const to = list.findIndex((b) => b.id === overId)
        if (readOnlyRef.current || to === -1 || id === overId) return
        apply(moveBlockToIndex(list, id, to))
      },
      focusEnd: () => {
        const list = docRef.current
        const last = list[list.length - 1]
        if (readOnlyRef.current) return
        if (last && last.type === 'p' && last.text === '') {
          handles.current.get(last.id)?.focus({ kind: 'offset', start: 0 })
          return
        }
        const created: Block = { id: newId(), type: 'p', text: '' }
        apply([...list, created], { focus: at(created.id, 0) })
      },
      undo: undoStep,
      redo: redoStep,
    }
  }, [])

  const menuOpen = menu !== null
  useEffect(() => {
    if (!menuOpen) return undefined
    const check = (): void => ctrl.checkMenu()
    document.addEventListener('selectionchange', check)
    return () => document.removeEventListener('selectionchange', check)
  }, [menuOpen, ctrl])

  const currentId = useMemo<ID | null>(() => {
    const focusable = (b: Block): boolean => b.type !== 'divider'
    const active = doc.find((b) => b.id === activeId && focusable(b))
    return (active ?? doc.find(focusable))?.id ?? null
  }, [doc, activeId])

  return { doc, ctrl, menu, currentId }
}
