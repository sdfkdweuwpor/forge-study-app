import { X } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { recordError } from '@/app/reportError'
import { addSubtask, removeSubtask, toggleSubtask, updateSubtask } from '@/db/repos/tasks'
import type { Task } from '@/db/types'
import { subtaskProgress } from '@/logic/taskDisplay'
import { useToast } from '@/ui/Toast'
import { Checkbox } from '@/ui/Checkbox'
import { IconButton } from '@/ui/IconButton'
import { InlineTitle } from './InlineTitle'
import styles from './SubtasksField.module.css'

function report(what: string): (error: unknown) => void {
  return (error) => recordError(error, what)
}

/** The checklist: tick items, rename them in place, remove them (with Undo) and add more with Enter. */
export function SubtasksField({ task }: { task: Pick<Task, 'id' | 'subtasks'> }) {
  const toast = useToast()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const progress = subtaskProgress(task.subtasks)

  function add() {
    const title = draft.trim()
    if (title === '') return
    setDraft('')
    addSubtask(task.id, title).catch(report('addSubtask'))
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    } else if (e.key === 'Escape' && draft !== '') {
      e.stopPropagation()
      setDraft('')
    }
  }

  return (
    <section className={styles.root} aria-labelledby={`subtasks-${task.id}`}>
      <h3 className={styles.heading} id={`subtasks-${task.id}`}>
        Subtasks
        {progress ? <span className={styles.count}>{progress.text}</span> : null}
      </h3>
      {task.subtasks.length > 0 ? (
        <ul className={styles.list}>
          {task.subtasks.map((item) => (
            <li key={item.id} className={styles.item}>
              <Checkbox
                variant="round"
                aria-label={`Done: ${item.title}`}
                checked={item.done}
                onCheckedChange={() =>
                  void toggleSubtask(task.id, item.id).catch(report('toggleSubtask'))
                }
              />
              <InlineTitle
                className={styles.title}
                value={item.title}
                label="Subtask"
                done={item.done}
                editing={editingId === item.id}
                onEditingChange={(editing) => setEditingId(editing ? item.id : null)}
                onCommit={(title) =>
                  void updateSubtask(task.id, item.id, { title }).catch(report('renameSubtask'))
                }
              />
              <IconButton
                className={styles.remove}
                size="xs"
                label={`Remove ${item.title}`}
                icon={<X />}
                onClick={() => {
                  removeSubtask(task.id, item.id)
                    .then((result) => {
                      if (result)
                        toast.show({ title: `Removed “${item.title}”`, undo: result.undo })
                    })
                    .catch(report('removeSubtask'))
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <input
        className={styles.add}
        value={draft}
        placeholder="Add a subtask"
        aria-label="Add a subtask"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
      />
    </section>
  )
}
