import type { ReactNode } from 'react'
import { BookOpen, Calendar, CalendarClock, Clock, Flag, Repeat, Timer } from 'lucide-react'
import { Tag } from '@/ui/Tag'
import type { Chip, ChipKind } from './chips'
import styles from './QuickAdd.module.css'

const ICONS: Record<ChipKind, ReactNode> = {
  date: <Calendar />,
  time: <Clock />,
  deadline: <CalendarClock />,
  duration: <Timer />,
  // The label already starts with "#".
  tag: null,
  priority: <Flag />,
  estimate: <Timer />,
  recurrence: <Repeat />,
  course: <BookOpen />,
}

export interface QuickAddChipsProps {
  chips: readonly Chip[]
  /** Shown while there is nothing to show as chips. */
  hint: ReactNode
  id: string
}

/** The parsed pieces, live under the input. An empty row teaches the syntax instead of collapsing. */
export function QuickAddChips({ chips, hint, id }: QuickAddChipsProps) {
  return (
    <div className={styles.chipsRow}>
      {chips.length > 0 ? (
        <ul className={styles.chips} aria-label="Parsed details" id={id}>
          {chips.map((chip) => (
            <li key={chip.key} className={styles.chipItem} data-motion="opacity">
              <Tag
                color={chip.color}
                shape="pill"
                icon={ICONS[chip.kind]}
                title={chip.name}
                data-kind={chip.kind}
              >
                {chip.label}
              </Tag>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>{hint}</p>
      )}
    </div>
  )
}
