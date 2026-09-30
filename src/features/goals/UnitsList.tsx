import { MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ID, Milestone, Unit } from '@/db/types'
import { Checkbox } from '@/ui/Checkbox'
import { Dropdown } from '@/ui/Dropdown'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import { useGoalActions } from './actions'
import { InlineField } from './InlineField'
import { SortableList } from './Sortable'
import styles from './UnitsList.module.css'

function UnitRow({ unit, handle }: { unit: Unit; handle: React.ReactNode }) {
  const actions = useGoalActions()
  const done = unit.status === 'done'
  return (
    <div className={styles.row} data-done={done || undefined}>
      <span className={styles.handle}>{handle}</span>
      <Checkbox
        aria-label={`${unit.title}, done`}
        checked={done}
        onCheckedChange={(checked) => void actions.setUnitDone(unit, checked)}
      />
      <div className={styles.title}>
        <InlineField
          label="Unit title"
          value={unit.title}
          maxLength={120}
          size={28}
          accept={(text) => text !== ''}
          onCommit={(title) => void actions.updateUnit(unit.id, { title })}
        />
      </div>
      <div className={styles.minutes}>
        <InlineField
          label={`Minutes for ${unit.title}`}
          value={unit.estimateMinutes === null ? '' : String(unit.estimateMinutes)}
          display={unit.estimateMinutes === null ? '—' : `${unit.estimateMinutes} min`}
          inputMode="numeric"
          size={5}
          align="end"
          accept={(text) => text === '' || /^\d+$/.test(text)}
          onCommit={(text) =>
            void actions.updateUnit(unit.id, { estimateMinutes: text === '' ? null : Number(text) })
          }
        />
      </div>
      <Dropdown
        label={`Actions for ${unit.title}`}
        align="end"
        items={[
          {
            id: 'delete',
            label: 'Delete unit',
            icon: <Trash2 />,
            danger: true,
            onSelect: () => void actions.deleteUnit(unit),
          },
        ]}
        trigger={(p) => (
          <IconButton
            {...p}
            className={styles.more}
            label={`Actions for ${unit.title}`}
            icon={<MoreHorizontal />}
            size="xs"
            tooltip={false}
          />
        )}
      />
    </div>
  )
}

export interface UnitsListProps {
  course: Pick<Milestone, 'id' | 'status'>
  units: readonly Unit[]
  /** Bump to focus the "add a unit" field (the `n` shortcut). */
  focusRequest: number
}

/**
 * A course's units (chapters): check them off, rename them, give one an estimate, reorder them by the
 * handle, add more at the bottom. Checking a unit off removes its study blocks from the schedule and pulls
 * the rest forward. A unit with no estimate shares the course's leftover hours with the others.
 */
export function UnitsList({ course, units, focusRequest }: UnitsListProps) {
  const actions = useGoalActions()
  const input = useRef<HTMLInputElement | null>(null)
  const [title, setTitle] = useState('')
  const done = units.filter((u) => u.status === 'done').length

  useEffect(() => {
    if (focusRequest > 0) input.current?.focus()
  }, [focusRequest])

  async function add(e: FormEvent) {
    e.preventDefault()
    const text = title.trim()
    if (text === '') return
    const created = await actions.addUnit(course.id as ID, text)
    if (created) setTitle('')
    input.current?.focus()
  }

  return (
    <div className={styles.root}>
      {units.length > 0 ? (
        <>
          <p className={styles.count}>
            {done} of {units.length} done
          </p>
          <SortableList
            items={units}
            nameOf={(u) => u.title}
            onReorder={(ids) => void actions.reorderUnits(course.id, ids)}
            rowClassName={styles.item}
            renderRow={(unit, { handle }) => <UnitRow unit={unit} handle={handle} />}
          />
        </>
      ) : (
        <p className={styles.empty}>
          No units yet. Until you add some, the course is planned as one block of study.
        </p>
      )}
      <form className={styles.add} onSubmit={add}>
        <Plus className={styles.addIcon} size={16} aria-hidden="true" />
        <Input
          ref={input as never}
          size="sm"
          aria-label="Add a unit"
          placeholder="Add a unit or chapter"
          maxLength={120}
          value={title}
          className={styles.addInput}
          onChange={(e) => setTitle(e.target.value)}
        />
      </form>
    </div>
  )
}
