/**
 * The task link: a button that names the linked task (or invites you to link one) and opens a small
 * popover with a searchable list of open tasks, the ARIA combobox pattern: focus stays in the search
 * field, the arrow keys move a highlighted option (`aria-activedescendant`), Enter picks it, Esc
 * closes. The list is `rankFocusTasks`: what you would work on next, or a fuzzy search over titles
 * and course codes.
 */
import { ChevronDown, ListChecks, Search, X } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { useOpenTasks } from '@/db/hooks/useTasks'
import type { ID } from '@/db/types'
import { rankFocusTasks, type FocusTaskHit } from '@/logic/focusTasks'
import { deadlineLabel, dueLabel } from '@/logic/taskDisplay'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { Popover } from '@/ui/Popover'
import { Skeleton } from '@/ui/Skeleton'
import styles from './TaskPicker.module.css'

export interface TaskPickerProps {
  /** The linked task id, or `null`. */
  taskId: ID | null
  /** Its title once loaded (`undefined` while loading, `null` if the task is gone). */
  title: string | null | undefined
  onChange: (taskId: ID | null) => void
}

/** The title with the letters the query matched in bold. */
function highlight(title: string, matches: readonly number[]): ReactNode {
  if (matches.length === 0) return title
  const hit = new Set(matches)
  const parts: ReactNode[] = []
  let run = ''
  let inHit = false
  const flush = (key: number) => {
    if (run === '') return
    parts.push(inHit ? <b key={key}>{run}</b> : run)
    run = ''
  }
  for (let i = 0; i < title.length; i++) {
    const isHit = hit.has(i)
    if (isHit !== inHit) {
      flush(i)
      inHit = isHit
    }
    run += title[i]
  }
  flush(title.length)
  return parts
}

export function TaskPicker({ taskId, title, onChange }: TaskPickerProps) {
  const label = taskId === null ? 'Link a task' : (title ?? 'Task')
  return (
    <Popover
      label="Link a task"
      className={styles.popover}
      side="bottom"
      align="center"
      offset={8}
      trigger={(p) => (
        <Button
          {...p}
          variant="secondary"
          className={styles.trigger}
          iconLeft={<ListChecks />}
          iconRight={<ChevronDown />}
          aria-label={
            taskId === null ? 'Link a task' : `Linked task: ${title ?? 'loading'}. Change`
          }
          data-testid="task-picker"
        >
          <span className={styles.triggerText} data-empty={taskId === null || undefined}>
            {label}
          </span>
        </Button>
      )}
    >
      {({ close }) => (
        <PickerPanel
          taskId={taskId}
          onPick={(id) => {
            onChange(id)
            close()
          }}
        />
      )}
    </Popover>
  )
}

function PickerPanel({ taskId, onPick }: { taskId: ID | null; onPick: (id: ID | null) => void }) {
  const tasks = useOpenTasks()
  const today = useToday()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const hits = useMemo<FocusTaskHit[]>(
    () => (tasks ? rankFocusTasks(tasks, query, today, 8) : []),
    [tasks, query, today],
  )
  const active = Math.min(cursor, Math.max(0, hits.length - 1))
  const optionId = (id: ID) => `${listId}-${id}`
  const activeHit = hits[active]
  const activeId = activeHit ? optionId(activeHit.task.id) : undefined

  // Keep the highlighted option in view when the list scrolls.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(hits.length === 0 ? 0 : (active + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(hits.length === 0 ? 0 : (active - 1 + hits.length) % hits.length)
    } else if (e.key === 'Enter' && activeHit) {
      e.preventDefault()
      onPick(activeHit.task.id)
    }
  }

  return (
    <div className={styles.panel}>
      <Input
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label="Search open tasks"
        placeholder="Search open tasks"
        leadingIcon={<Search />}
        value={query}
        data-autofocus=""
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          setCursor(0)
        }}
        onKeyDown={onKeyDown}
      />

      {tasks === undefined ? (
        <div className={styles.loading} role="status" aria-busy="true" aria-label="Loading tasks">
          <Skeleton width="80%" />
          <Skeleton width="60%" />
          <Skeleton width="70%" />
        </div>
      ) : null}

      {/* The list is always there (the search field points at it) but only ever holds options. */}
      <div
        id={listId}
        role="listbox"
        aria-label="Open tasks"
        aria-busy={tasks === undefined || undefined}
        className={styles.list}
      >
        {hits.map((hit, i) => {
          const due = dueLabel(hit.task, today) ?? deadlineLabel(hit.task, today)
          return (
            <button
              key={hit.task.id}
              id={optionId(hit.task.id)}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={hit.task.id === taskId}
              className={styles.option}
              data-active={i === active || undefined}
              onMouseEnter={() => setCursor(i)}
              onClick={() => onPick(hit.task.id)}
            >
              <span className={styles.optionTitle}>{highlight(hit.task.title, hit.matches)}</span>
              {hit.task.status === 'doing' ? (
                <span className={styles.optionMeta}>In progress</span>
              ) : due ? (
                <span className={styles.optionMeta} data-tone={due.tone}>
                  {due.text}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {tasks !== undefined && hits.length === 0 ? (
        <p className={styles.empty}>
          {query.trim() === ''
            ? 'No open tasks yet. Press Q to add one.'
            : 'No open task matches that.'}
        </p>
      ) : null}

      {taskId !== null ? (
        <Button
          variant="ghost"
          size="sm"
          className={styles.clear}
          iconLeft={<X />}
          onClick={() => onPick(null)}
        >
          Unlink task
        </Button>
      ) : null}
    </div>
  )
}
