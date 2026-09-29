import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTheme } from '@/app/providers/ThemeProvider'
import { Link } from '@/app/router'
import type { ID, Task } from '@/db/types'
import {
  BOARD_COLUMN_IDS,
  boardIds,
  columnKey,
  columnLabel,
  dropOver,
  findColumn,
  moveOver,
  parseColumnKey,
  placementOf,
  type BoardIds,
  type BoardModel,
  type Placement,
} from '@/logic/boardColumns'
import { useToast } from '@/ui/Toast'
import { TaskRow } from '../TaskRow'
import { BoardColumn } from './BoardColumn'
import { CardMouseSensor, CardTouchSensor } from './cardSensors'
import type { BoardMove } from './BoardMove'
import styles from './Board.module.css'

export interface BoardViewProps {
  model: BoardModel
  /** Cards can be put in a new order inside To do and Doing (the manual sort). */
  reorderable: boolean
  selectedId: ID | null
  /** The selection was moved with the keyboard, so the selected card scrolls into view. */
  revealSelected: boolean
  onSelect: (id: ID) => void
  /** Applies a drop. Resolves false when the write failed. */
  onMove: (move: BoardMove) => Promise<boolean>
}

/** How long the dropped layout is kept after the write, so the live query has time to catch up. */
const SETTLE_MS = 180

/**
 * ← / → while a card is picked up jump to the same height in the neighbouring column (or to its top
 * when it is empty); ↑ / ↓ use the sortable list's own stepping.
 */
const boardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') {
    return sortableKeyboardCoordinates(event, args)
  }
  const { active, context } = args
  const { droppableContainers, droppableRects, collisionRect } = context
  const current: unknown = droppableContainers.get(active)?.data.current?.sortable?.containerId
  const from = BOARD_COLUMN_IDS.findIndex((c) => c === current)
  const to = BOARD_COLUMN_IDS[from + (event.code === 'ArrowRight' ? 1 : -1)]
  if (from === -1 || to === undefined || !collisionRect) return undefined
  event.preventDefault()

  const middle = collisionRect.top + collisionRect.height / 2
  let best: { left: number; top: number; distance: number } | null = null
  for (const container of droppableContainers.getEnabled()) {
    if (container.data.current?.sortable?.containerId !== to) continue
    const rect = droppableRects.get(container.id)
    if (!rect) continue
    const distance = Math.abs(rect.top + rect.height / 2 - middle)
    if (best === null || distance < best.distance) best = { left: rect.left, top: rect.top, distance }
  }
  if (best) return { x: best.left, y: best.top }
  const column = droppableRects.get(columnKey(to))
  return column ? { x: column.left, y: column.top } : undefined
}

function describe(placement: Placement | null): string {
  return placement
    ? `${columnLabel(placement.column)}, position ${placement.index + 1} of ${placement.count}`
    : 'the board'
}

/**
 * The board: To do, Doing and Done. Drag a card by pointer (a long press on touch) or with the keyboard
 * (focus its grip, Space, arrow keys, Space). While dragging, the cards rearrange live, so the drop is
 * exactly what you see; the write happens on drop and its toast has Undo. Everything is announced.
 */
export function BoardView({
  model,
  reorderable,
  selectedId,
  revealSelected,
  onSelect,
  onMove,
}: BoardViewProps) {
  const dndId = useId()
  const { reducedMotion } = useTheme()
  const toast = useToast()
  const modelIds = useMemo(() => boardIds(model), [model])
  const tasksById = useMemo(() => {
    const map = new Map<ID, Task>()
    for (const column of BOARD_COLUMN_IDS) for (const task of model.columns[column]) map.set(task.id, task)
    return map
  }, [model])

  /** The layout while a card is in the air. */
  const [draft, setDraft] = useState<BoardIds | null>(null)
  /** The dropped layout, kept until the write has landed and the live query has caught up. */
  const [held, setHeld] = useState<BoardIds | null>(null)
  const [activeId, setActiveId] = useState<ID | null>(null)
  const ids = draft ?? held ?? modelIds

  const started = useRef<Placement | null>(null)
  const settle = useRef(0)
  const lastOverId = useRef<UniqueIdentifier | null>(null)
  const recentlyMoved = useRef(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      recentlyMoved.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [draft])

  const sensors = useSensors(
    useSensor(CardMouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(CardTouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardCoordinates }),
  )

  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      const byPointer = pointerWithin(args)
      const hits = byPointer.length > 0 ? byPointer : rectIntersection(args)
      let overId = getFirstCollision(hits, 'id')
      if (overId != null) {
        const column = parseColumnKey(String(overId))
        const cards = column ? ids[column] : []
        if (column && cards.length > 0) {
          // Over a column with cards: the card nearest the dragged one decides where it lands.
          const nearest = closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter(
              (c) => c.id !== overId && cards.includes(String(c.id)),
            ),
          })[0]?.id
          overId = nearest ?? overId
        }
        lastOverId.current = overId
        return [{ id: overId }]
      }
      // Right after a card changed column it may be over nothing for a frame: keep the last target.
      if (recentlyMoved.current) lastOverId.current = args.active.id
      return lastOverId.current !== null ? [{ id: lastOverId.current }] : []
    },
    [ids],
  )

  const titleOf = (id: UniqueIdentifier): string => tasksById.get(String(id))?.title ?? 'task'
  const isBelow = (event: Pick<DragOverEvent, 'active' | 'over'>): boolean => {
    const translated = event.active.rect.current.translated
    const over = event.over
    return translated && over
      ? translated.top + translated.height / 2 > over.rect.top + over.rect.height / 2
      : false
  }

  function onDragStart({ active }: DragStartEvent) {
    const id = String(active.id)
    lastOverId.current = null
    started.current = placementOf(ids, id)
    setActiveId(id)
    setDraft(ids)
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    const below = isBelow(event)
    setDraft((prev) => {
      const base = prev ?? ids
      const next = moveOver(base, String(active.id), String(over.id), below)
      if (next !== base) recentlyMoved.current = true
      return next
    })
  }

  function reset() {
    setActiveId(null)
    setDraft(null)
    started.current = null
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id)
    const before = started.current
    const current = draft ?? ids
    reset()
    if (!over || !before) return
    const final = dropOver(current, id, String(over.id))
    const now = placementOf(final, id)
    if (!now) return
    const moved = now.column !== before.column
    const reordered = !moved && now.index !== before.index
    if (!moved) {
      if (reordered && !reorderable && now.column !== 'done') {
        toast.show({
          title: 'Reordering is off',
          description: 'Choose Manual under Sort to move cards yourself.',
        })
      }
      if (!reordered || !reorderable || now.column === 'done') return
    }

    const token = (settle.current += 1)
    setHeld(final)
    void onMove({
      id,
      from: before.column,
      to: now.column,
      above: now.above,
      below: now.below,
      reorder: reorderable && now.column !== 'done',
    }).then((ok) => {
      window.setTimeout(() => {
        if (settle.current === token) setHeld(null)
      }, ok ? SETTLE_MS : 0)
    })
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${titleOf(active.id)}. It is in ${describe(placementOf(ids, String(active.id)))}.`,
    onDragOver: (event) => {
      if (!event.over) return undefined
      const id = String(event.active.id)
      const next = moveOver(draft ?? ids, id, String(event.over.id), isBelow(event))
      return `${titleOf(id)} is over ${describe(placementOf(next, id))}.`
    },
    onDragEnd: ({ active, over }) => {
      const id = String(active.id)
      if (!over) return `${titleOf(id)} dropped. Nothing changed.`
      const now = placementOf(dropOver(draft ?? ids, id, String(over.id)), id)
      if (!now) return `${titleOf(id)} dropped.`
      if (now.column !== started.current?.column) {
        return `Moved ${titleOf(id)} to ${columnLabel(now.column)}.`
      }
      return !reorderable || now.column === 'done'
        ? `${titleOf(id)} stays in ${columnLabel(now.column)}. Its place follows the sort.`
        : `Moved ${titleOf(id)} to position ${now.index + 1} of ${now.count} in ${columnLabel(now.column)}.`
    },
    onDragCancel: ({ active }) =>
      `Move cancelled. ${titleOf(active.id)} is back in ${describe(started.current)}.`,
  }

  const activeTask = activeId ? tasksById.get(activeId) : undefined
  const targetColumn = activeId ? findColumn(ids, activeId) : null

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To move this card, press Space or Enter. Use the arrow keys to move it within a column or to the next one, then press Space or Enter to drop it. Press Escape to cancel.',
        },
      }}
    >
      <div className={styles.board} role="group" aria-label="Board">
        {BOARD_COLUMN_IDS.map((column) => (
          <BoardColumn
            key={column}
            id={column}
            tasks={ids[column].flatMap((id) => {
              const task = tasksById.get(id)
              return task ? [task] : []
            })}
            target={targetColumn === column}
            selectedId={selectedId}
            reveal={revealSelected}
            onSelect={onSelect}
            footer={
              column === 'done' && model.olderDone > 0 ? (
                <>
                  {model.olderDone} older ·{' '}
                  <Link to="tasks" params={{ list: 'completed' }}>
                    See Completed
                  </Link>
                </>
              ) : null
            }
          />
        ))}
      </div>
      <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
        {activeTask ? (
          <div className={styles.overlay}>
            <TaskRow variant="card" preview dragging task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
