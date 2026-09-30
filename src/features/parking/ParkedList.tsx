import { Check, ListPlus, Trash2 } from 'lucide-react'
import type { ParkingItem } from '@/db/types'
import { IconButton } from '@/ui/IconButton'
import { useParkedActions } from './useParkedActions'
import styles from './ParkedList.module.css'

/**
 * A compact list of parked thoughts, each with the three things you can do to it: turn it into a task,
 * mark it done, or delete it. Used by the end-of-session dialog and the Today card. Every action is a
 * button with its own name and a toast that can undo it.
 */
export function ParkedList({ items, label }: { items: readonly ParkingItem[]; label: string }) {
  const actions = useParkedActions()
  return (
    <ul className={styles.list} aria-label={label} data-testid="parked-list">
      {items.map((item) => (
        <li key={item.id} className={styles.row} data-testid="parked-item">
          <span className={styles.text}>{item.text}</span>
          <span className={styles.actions}>
            <IconButton
              label="Convert to task"
              icon={<ListPlus />}
              onClick={() => void actions.convert(item)}
            />
            <IconButton label="Done" icon={<Check />} onClick={() => void actions.done(item)} />
            <IconButton
              label="Delete"
              icon={<Trash2 />}
              onClick={() => void actions.remove(item)}
            />
          </span>
        </li>
      ))}
    </ul>
  )
}
