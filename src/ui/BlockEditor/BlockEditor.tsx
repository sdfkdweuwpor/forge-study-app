import { useId, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CircleAlert } from 'lucide-react'
import { filterSlash, stripInline, type Block } from '@/logic/blocks'
import { Button } from '../Button'
import { EmptyState } from '../EmptyState'
import { Skeleton } from '../Skeleton'
import { cx } from '../internal/cx'
import { BLOCK_LABELS, BlockRow } from './BlockRow'
import { SlashMenu, slashOptionId } from './SlashMenu'
import { useBlockEditor } from './useBlockEditor'
import styles from './BlockEditor.module.css'

export interface BlockEditorProps {
  /** The document. The editor keeps its own copy while you type, so `value` may lag (debounced saves). */
  value: readonly Block[]
  /** Called with the whole document after every edit. Debounce your save, not this. */
  onChange?: (blocks: Block[]) => void
  /** Hint in an empty paragraph while it has the caret (and always when it is the only block). */
  placeholder?: string
  readOnly?: boolean
  /** Shows skeleton lines instead of the document. */
  loading?: boolean
  /** Replaces the document with an error state (and a retry button when `onRetry` is given). */
  error?: ReactNode
  onRetry?: () => void
  /** Shown instead of a blank page when a read-only document is empty. */
  emptyLabel?: ReactNode
  className?: string
  /** Accessible name of the whole editor. Default "Notes". */
  'aria-label'?: string
}

/** Blocks only move up and down; a drag must not wander sideways. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

const HELP =
  'Type slash for block types. Alt plus arrow up or down moves the current block. Escape leaves the editor.'

function BlockEditorSkeleton({ className, label }: { className?: string; label: string }) {
  return (
    <div
      className={cx(styles.root, className)}
      role="group"
      aria-label={label}
      aria-busy="true"
      data-plain
    >
      <div className={styles.skeleton}>
        <Skeleton width="42%" height={28} variant="block" />
        <Skeleton lines={3} />
        <Skeleton width="70%" />
      </div>
    </div>
  )
}

interface EditorProps extends Required<Pick<BlockEditorProps, 'value' | 'placeholder' | 'readOnly'>> {
  onChange: BlockEditorProps['onChange']
  emptyLabel: ReactNode
  className: string | undefined
  label: string
}

function Editor({ value, onChange, placeholder, readOnly, emptyLabel, className, label }: EditorProps) {
  const { doc, ctrl, menu, currentId } = useBlockEditor({ value, onChange, readOnly })
  const listboxId = useId()
  const helpId = useId()
  const [root, setRoot] = useState<HTMLDivElement | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const ids = useMemo(() => doc.map((b) => b.id), [doc])
  const items = menu ? filterSlash(menu.query) : []
  const activeItem = menu ? items[menu.index] : undefined
  const activeOption = activeItem ? slashOptionId(listboxId, activeItem.id) : undefined

  const describe = (id: UniqueIdentifier): string => {
    const block = doc.find((b) => b.id === id)
    if (!block) return 'block'
    const text = stripInline(block.text).trim()
    const short = text.length > 40 ? `${text.slice(0, 40)}…` : text
    return `${BLOCK_LABELS[block.type]}${short ? `: ${short}` : ', empty'}`
  }
  const position = (id: UniqueIdentifier): string =>
    `position ${doc.findIndex((b) => b.id === id) + 1} of ${doc.length}`

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${describe(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${describe(active.id)} is now at ${position(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${describe(active.id)} at ${position(over.id)}.`
        : `${describe(active.id)} was dropped where it started.`,
    onDragCancel: ({ active }) => `Moving ${describe(active.id)} was cancelled.`,
  }

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (over && active.id !== over.id) ctrl.reorder(String(active.id), String(over.id))
  }

  // Dropped files or text must neither navigate away nor land inside a block.
  const refuseDrag = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'none'
  }

  if (readOnly && value.length === 0) {
    return (
      <div className={cx(styles.root, className)} role="group" aria-label={label} data-plain>
        <p className={styles.empty}>{emptyLabel}</p>
      </div>
    )
  }

  return (
    <div
      ref={setRoot}
      className={cx(styles.root, className)}
      role="group"
      aria-label={label}
      aria-describedby={readOnly ? undefined : helpId}
      data-readonly={readOnly || undefined}
      onDragOver={refuseDrag}
      onDrop={refuseDrag}
    >
      {!readOnly && (
        <span id={helpId} className="sr-only">
          {HELP}
        </span>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[verticalOnly]}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'To pick up a block, press space or enter on its handle. Use the arrow keys to move it, space or enter to drop it, and escape to cancel.',
          },
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {doc.map((block) => (
            <BlockRow
              key={block.id}
              block={block}
              ctrl={ctrl}
              readOnly={readOnly}
              current={block.id === currentId}
              only={doc.length === 1}
              placeholder={placeholder}
              menuListbox={menu?.id === block.id && activeOption ? listboxId : undefined}
              menuActive={menu?.id === block.id ? activeOption : undefined}
            />
          ))}
        </SortableContext>
      </DndContext>

      {!readOnly && (
        // Clicking the empty space under the last block writes there, like a page.
        <div
          className={styles.tail}
          role="presentation"
          onMouseDown={(e) => {
            e.preventDefault()
            ctrl.focusEnd()
          }}
        />
      )}

      {menu && items.length > 0 && (
        <SlashMenu
          id={listboxId}
          items={items}
          activeIndex={menu.index}
          onChoose={ctrl.chooseSlash}
          onHover={ctrl.hoverSlash}
          getAnchor={ctrl.menuAnchor}
          origin={root}
        />
      )}
    </div>
  )
}

/**
 * A Notion-style block editor for notes: paragraphs, three heading levels, bullets, to-dos,
 * callouts and dividers, each an editable line of plain text.
 *
 * - Inline marks (`**bold**`, `*italic*`, `` `code` ``, `[label](url)`) show as raw text while a
 *   block is edited and render when it is not. Mod+B, Mod+I and Mod+E add them.
 * - `/` at the start of an empty block, or after a space, opens the block menu; markdown at the
 *   start of a paragraph or list item converts it (`# `, `## `, `### `, `- `, `[] `, `> `, `---`).
 * - Enter splits, Shift+Enter adds a line, Backspace at the start turns a block into a
 *   paragraph and then merges it up, Delete at the end merges the next block in. Up/Down and
 *   Left/Right cross block edges; Alt+Up/Down move the block; Mod+Shift+Enter ticks a to-do;
 *   Mod+Z / Mod+Shift+Z undo and redo. Tab stays inside the editor, Esc leaves it.
 * - Pasting inserts plain text, one block per line. Blocks can be dragged by their handle.
 *
 * Controlled by `value` / `onChange`. The editor keeps its own copy while you type, so a parent
 * that saves with a delay can hand `value` back late without losing keystrokes.
 */
export function BlockEditor({
  value,
  onChange,
  placeholder = "Type '/' for commands",
  readOnly = false,
  loading = false,
  error,
  onRetry,
  emptyLabel = 'Nothing here yet.',
  className,
  'aria-label': label = 'Notes',
}: BlockEditorProps) {
  if (loading) return <BlockEditorSkeleton className={className} label={label} />
  if (error) {
    return (
      <div className={cx(styles.root, className)} role="group" aria-label={label} data-plain>
        <EmptyState
          role="alert"
          size="sm"
          icon={<CircleAlert />}
          title="These notes could not be loaded"
          description={error}
          action={
            onRetry ? (
              <Button size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }
  return (
    <Editor
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={readOnly}
      emptyLabel={emptyLabel}
      className={className}
      label={label}
    />
  )
}
