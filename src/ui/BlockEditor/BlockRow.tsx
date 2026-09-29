import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type FocusEvent,
  type FormEvent,
  type MouseEvent,
} from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus } from 'lucide-react'
import { sourceOffset, type Block } from '@/logic/blocks'
import { Checkbox } from '../Checkbox'
import { IconButton } from '../IconButton'
import { Popover } from '../Popover'
import { EmojiGrid } from '../PageHeader/EmojiGrid'
import {
  contentBox,
  editableMode,
  getSelectionOffsets,
  readText,
  revealCaret,
  setSelectionOffsets,
  textOffsetAtPoint,
  writeFormatted,
  writeRaw,
  type Selected,
} from './dom'
import { lineCenterY } from './geometry'
import type { FocusTarget, RowController } from './types'
import styles from './BlockEditor.module.css'

export const DEFAULT_CALLOUT_EMOJI = '💡'

/** Screen-reader name of the text field, by block type. */
export const BLOCK_LABELS: Readonly<Record<Block['type'], string>> = {
  p: 'Text',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  bullet: 'Bulleted list item',
  todo: 'To-do item',
  callout: 'Callout',
  divider: 'Divider',
}

/** The hint an empty block shows while it holds the caret. */
const HINTS: Readonly<Record<Block['type'], string | null>> = {
  p: null, // the editor's `placeholder`
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  bullet: 'List item',
  todo: 'To-do',
  callout: 'Type something',
  divider: null,
}

/** The text last drawn as formatted runs in each element, so an unchanged block is not redrawn. */
const drawn = new WeakMap<HTMLElement, string>()

const isRaw = (el: HTMLElement): boolean => el.dataset.mode === 'raw'

/** Switches an element to raw text (what is edited) and puts the selection where asked. */
function enterRaw(el: HTMLElement, text: string, selection: Selected): void {
  el.dataset.mode = 'raw'
  drawn.delete(el)
  writeRaw(el, text)
  setSelectionOffsets(el, selection.start, selection.end)
}

/** Switches an element back to formatted runs. */
function leaveRaw(el: HTMLElement): void {
  const text = readText(el)
  el.dataset.mode = 'formatted'
  writeFormatted(el, text)
  drawn.set(el, text)
}

export interface BlockRowProps {
  block: Block
  ctrl: RowController
  readOnly: boolean
  /** This row holds the editor's single tab stop. */
  current: boolean
  /** The document has just this one block: its placeholder is always visible. */
  only: boolean
  placeholder: string
  /** Set on the block that owns the open slash menu: the listbox it controls and its highlighted option. */
  menuListbox?: string
  menuActive?: string
}

/**
 * One block. The text field is a contenteditable that React never renders children into: while
 * the block is edited it holds the raw text, otherwise the formatted runs, and this component
 * swaps them by hand (on focus and blur) so typing never fights a re-render.
 */
export const BlockRow = memo(function BlockRow({
  block,
  ctrl,
  readOnly,
  current,
  only,
  placeholder,
  menuListbox,
  menuActive,
}: BlockRowProps) {
  const sortable = useSortable({ id: block.id, disabled: readOnly })
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const dividerRef = useRef<HTMLDivElement | null>(null)
  /** Where the caret goes when the next focus event arrives (set before calling `focus()`). */
  const pending = useRef<Selected | null>(null)
  /** Where it was when the block last lost focus. */
  const lastSelection = useRef<Selected | null>(null)
  const latestText = useRef(block.text)
  const isDivider = block.type === 'divider'

  // Keep the field's content in step with the text. While the block is edited the DOM already
  // has what was typed, so nothing is written unless the text changed some other way (a split,
  // a paste, undo).
  useLayoutEffect(() => {
    latestText.current = block.text
    const el = fieldRef.current
    if (!el) return
    if (readOnly && isRaw(el)) leaveRaw(el) // switched to read-only while being edited
    if (isRaw(el)) {
      if (readText(el) === block.text) return
      const selection = el.ownerDocument.activeElement === el ? getSelectionOffsets(el) : null
      writeRaw(el, block.text)
      if (selection) {
        const max = block.text.length
        setSelectionOffsets(el, Math.min(selection.start, max), Math.min(selection.end, max))
      }
    } else if (drawn.get(el) !== block.text) {
      writeFormatted(el, block.text)
      drawn.set(el, block.text)
    }
  }, [block.text, block.type, readOnly])

  useLayoutEffect(() => {
    ctrl.register(block.id, {
      element: () => (isDivider ? dividerRef.current : fieldRef.current),
      offsets: () => (fieldRef.current ? getSelectionOffsets(fieldRef.current) : null),
      focus: (target: FocusTarget) => {
        const divider = dividerRef.current
        if (divider) {
          divider.focus()
          return
        }
        const el = fieldRef.current
        if (!el) return
        const text = latestText.current
        let selection: Selected
        if (target.kind === 'point') {
          let at = target.edge === 'first' ? 0 : text.length
          if (!isRaw(el)) {
            const y = lineCenterY(contentBox(el), target.edge)
            const visible = textOffsetAtPoint(el, target.x, y)
            if (visible !== null) at = sourceOffset(text, visible)
          }
          selection = { start: at, end: at }
        } else {
          selection = { start: target.start, end: target.end ?? target.start }
        }
        if (el.ownerDocument.activeElement === el) {
          enterRaw(el, text, selection)
        } else {
          pending.current = selection
          el.focus()
          pending.current = null
        }
        revealCaret(el)
      },
    })
    return () => ctrl.register(block.id, null)
  }, [block.id, ctrl, isDivider])

  // The browser's `beforeinput` (React's onBeforeInput is a different, older event).
  useEffect(() => {
    const el = fieldRef.current
    if (!el || readOnly) return undefined
    const onBeforeInput = (e: InputEvent): void => ctrl.beforeInput(e, block.id)
    el.addEventListener('beforeinput', onBeforeInput)
    return () => el.removeEventListener('beforeinput', onBeforeInput)
  }, [ctrl, block.id, readOnly, isDivider])

  const onFocus = (e: FocusEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return
    const el = e.currentTarget
    ctrl.focused(block.id)
    if (isRaw(el)) return
    const selection = pending.current ?? lastSelection.current ?? { start: 0, end: 0 }
    pending.current = null
    enterRaw(el, latestText.current, selection)
  }

  const onBlur = (e: FocusEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    if (e.target !== el) return
    // Focus is still here when the whole window was deactivated: keep editing when it returns.
    if (el.ownerDocument.activeElement === el) return
    lastSelection.current = getSelectionOffsets(el)
    leaveRaw(el)
    ctrl.blurred(block.id)
  }

  const onInput = (e: FormEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    const native = e.nativeEvent as InputEvent
    const text = readText(el)
    const selection = getSelectionOffsets(el)
    ctrl.input(
      block.id,
      text,
      selection?.start ?? text.length,
      native.inputType,
      native.isComposing,
    )
  }

  const onMouseDown = (e: MouseEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    if (readOnly || e.button !== 0 || isRaw(el) || e.ctrlKey || e.metaKey) return
    if (e.target instanceof Element && e.target.closest('a')) return
    // Place the caret ourselves: the formatted runs are about to become raw text, so where the
    // browser would put it is meaningless.
    e.preventDefault()
    const visible = textOffsetAtPoint(el, e.clientX, e.clientY)
    const at =
      visible === null ? latestText.current.length : sourceOffset(latestText.current, visible)
    pending.current = { start: at, end: at }
    el.focus()
    pending.current = null
  }

  // Links inside an editable element are not followed by the browser, so open them here.
  const onClick = (e: MouseEvent<HTMLDivElement>): void => {
    const link = e.target instanceof Element ? e.target.closest('a') : null
    if (!link || isRaw(e.currentTarget)) return
    e.preventDefault()
    window.open(link.href, '_blank', 'noopener,noreferrer')
  }

  const onPaste = (e: ClipboardEvent<HTMLDivElement>): void => ctrl.paste(e, block.id)

  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  }

  const label = BLOCK_LABELS[block.type]
  const hint = HINTS[block.type] ?? placeholder

  return (
    <div
      ref={sortable.setNodeRef}
      className={styles.row}
      style={style}
      data-type={block.type}
      data-checked={(block.type === 'todo' && block.checked) || undefined}
      data-dragging={sortable.isDragging || undefined}
    >
      {!readOnly && (
        <div className={styles.gutter}>
          <IconButton
            label="Add block below"
            icon={<Plus />}
            size="xs"
            tabIndex={-1}
            tooltipSide="bottom"
            onClick={() => ctrl.addBelow(block.id)}
          />
          <IconButton
            ref={sortable.setActivatorNodeRef}
            label="Drag to reorder"
            icon={<GripVertical />}
            size="xs"
            tooltipSide="bottom"
            className={styles.handle}
            {...sortable.attributes}
            {...sortable.listeners}
            tabIndex={-1}
          />
        </div>
      )}

      {isDivider ? (
        <div className={styles.body}>
          {/* Focusable so the arrow keys can land on it and Backspace can delete it. */}
          <div
            ref={dividerRef}
            className={styles.divider}
            role="separator"
            aria-orientation="horizontal"
            aria-label={label}
            data-block-id={block.id}
            tabIndex={readOnly ? undefined : -1}
            onKeyDown={readOnly ? undefined : (e) => ctrl.keyDown(e, block.id)}
          >
            <span className={styles.rule} aria-hidden="true" />
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          {block.type === 'bullet' && (
            <span className={styles.marker} aria-hidden="true">
              <span className={styles.dot} />
            </span>
          )}
          {block.type === 'todo' && (
            <span className={styles.marker}>
              <Checkbox
                variant="round"
                aria-label={`Completed: ${label}`}
                checked={block.checked ?? false}
                disabled={readOnly}
                tabIndex={-1}
                onCheckedChange={(checked) => ctrl.toggleChecked(block.id, checked)}
              />
            </span>
          )}
          {block.type === 'callout' && (
            <span className={styles.marker}>
              {readOnly ? (
                <span className={styles.emoji} aria-hidden="true">
                  {block.emoji ?? DEFAULT_CALLOUT_EMOJI}
                </span>
              ) : (
                <Popover
                  label="Choose emoji"
                  align="start"
                  trigger={(trigger) => (
                    <button
                      type="button"
                      className={styles.emoji}
                      aria-label="Change callout emoji"
                      tabIndex={-1}
                      {...trigger}
                    >
                      {block.emoji ?? DEFAULT_CALLOUT_EMOJI}
                    </button>
                  )}
                >
                  {({ close }) => (
                    <EmojiGrid
                      current={block.emoji ?? DEFAULT_CALLOUT_EMOJI}
                      onPick={(emoji) => {
                        ctrl.setEmoji(block.id, emoji)
                        close()
                      }}
                    />
                  )}
                </Popover>
              )}
            </span>
          )}
          <div
            ref={fieldRef}
            className={styles.text}
            role="textbox"
            aria-multiline="true"
            aria-label={label}
            aria-placeholder={hint}
            aria-readonly={readOnly || undefined}
            aria-autocomplete={menuListbox ? 'list' : undefined}
            aria-controls={menuListbox}
            aria-activedescendant={menuActive}
            contentEditable={readOnly ? false : editableMode()}
            tabIndex={current && !readOnly ? 0 : -1}
            data-block-id={block.id}
            data-empty={block.text === '' || undefined}
            data-only={only || undefined}
            data-hint={hint}
            spellCheck={!readOnly}
            onFocus={readOnly ? undefined : onFocus}
            onBlur={readOnly ? undefined : onBlur}
            onInput={readOnly ? undefined : onInput}
            onKeyDown={readOnly ? undefined : (e) => ctrl.keyDown(e, block.id)}
            onMouseDown={readOnly ? undefined : onMouseDown}
            onClick={readOnly ? undefined : onClick}
            onPaste={readOnly ? undefined : onPaste}
            onCompositionStart={readOnly ? undefined : ctrl.compositionStart}
            onCompositionEnd={
              readOnly
                ? undefined
                : (e) => {
                    const el = e.currentTarget
                    ctrl.compositionEnd(
                      block.id,
                      readText(el),
                      getSelectionOffsets(el)?.start ?? latestText.current.length,
                    )
                  }
            }
          />
        </div>
      )}
    </div>
  )
})
