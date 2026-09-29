import { Check, ChevronDown, Repeat } from 'lucide-react'
import { useState } from 'react'
import { recordError } from '@/app/reportError'
import { updateTask } from '@/db/repos/tasks'
import type { RecurrenceRule, Task } from '@/db/types'
import { weekdayOf } from '@/logic/dates'
import { describeRecurrence, nextOccurrences, WEEKDAY_SHORT_NAMES } from '@/logic/recurrence'
import {
  formFromRule,
  presetOf,
  recurrencePresets,
  ruleFromForm,
  toggleDay,
  type RecurrenceForm,
} from '@/logic/recurrenceForm'
import { formatDayLong } from '@/logic/taskDisplay'
import { Button } from '@/ui/Button'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { Input } from '@/ui/Input'
import { Popover, PopoverBody } from '@/ui/Popover'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { useTaskEnv } from './TaskActions'
import styles from './RecurrenceField.module.css'

interface RecurrenceFieldProps {
  task: Pick<Task, 'id' | 'recurrence' | 'dueDate'>
}

function save(id: string, recurrence: RecurrenceRule | null) {
  updateTask(id, { recurrence }).catch((error: unknown) => recordError(error, 'saveRecurrence'))
}

/** "Every 2 weeks on Mon, Wed" as you edit it, with the next few dates so the rule is never a guess. */
function CustomEditor({ task, close }: RecurrenceFieldProps & { close: () => void }) {
  const { today } = useTaskEnv()
  const [form, setForm] = useState<RecurrenceForm>(() => formFromRule(task.recurrence))
  const anchor = task.dueDate ?? today
  const rule = ruleFromForm(form)
  const preview = nextOccurrences(rule, anchor, 3)

  function update(next: RecurrenceForm) {
    setForm(next)
    save(task.id, ruleFromForm(next))
  }

  return (
    <PopoverBody>
      <div className={styles.editor}>
        <div className={styles.every}>
          <span className={styles.everyLabel}>Repeat every</span>
          <Input
            type="number"
            size="sm"
            min={1}
            max={99}
            className={styles.number}
            aria-label="Repeat interval"
            data-autofocus=""
            value={form.every}
            onChange={(e) => update({ ...form, every: Number(e.target.value) || 1 })}
          />
          <SegmentedControl<'day' | 'week'>
            label="Repeat unit"
            size="sm"
            value={form.unit}
            onValueChange={(unit) => update({ ...form, unit })}
            options={[
              { value: 'day', label: form.every === 1 ? 'day' : 'days' },
              { value: 'week', label: form.every === 1 ? 'week' : 'weeks' },
            ]}
          />
        </div>

        {form.unit === 'week' ? (
          <div className={styles.days} role="group" aria-label="Repeat on">
            {WEEKDAY_SHORT_NAMES.map((name, day) => (
              <button
                key={name}
                type="button"
                className={styles.day}
                aria-pressed={form.days.includes(day)}
                aria-label={name}
                onClick={() => update({ ...form, days: toggleDay(form.days, day) })}
              >
                {name.slice(0, 2)}
              </button>
            ))}
          </div>
        ) : null}

        <p className={styles.preview}>
          <strong>{describeRecurrence(rule)}.</strong> Next:{' '}
          {preview.map((d) => formatDayLong(d, today)).join(' · ')}
        </p>
        <div className={styles.actions}>
          <Button size="sm" variant="secondary" onClick={close}>
            Done
          </Button>
        </div>
      </div>
    </PopoverBody>
  )
}

/** The Repeat property: a menu of common rules, and "Custom…" for the rest. */
export function RecurrenceField({ task }: RecurrenceFieldProps) {
  const { today } = useTaskEnv()
  const [custom, setCustom] = useState(false)
  const weekday = weekdayOf(task.dueDate ?? today)
  const current = presetOf(task.recurrence, weekday)

  const items: MenuEntry[] = [
    ...recurrencePresets(weekday).map<MenuEntry>((preset) => ({
      id: preset.id,
      label: preset.label,
      icon: current === preset.id ? <Check /> : undefined,
      onSelect: () => save(task.id, preset.rule),
    })),
    { type: 'separator', id: 'sep-custom' },
    {
      id: 'custom',
      label: 'Custom…',
      icon: current === null ? <Check /> : undefined,
      onSelect: () => setCustom(true),
    },
  ]

  return (
    <Popover
      open={custom}
      onOpenChange={setCustom}
      side="bottom"
      align="start"
      label="Custom repeat"
      trigger={(popover) => (
        <Dropdown
          label="Repeat"
          items={items}
          trigger={(menu) => (
            <Button
              {...menu}
              ref={(node) => {
                menu.ref(node)
                popover.ref(node)
              }}
              variant="secondary"
              size="sm"
              iconLeft={<Repeat />}
              iconRight={<ChevronDown />}
            >
              {task.recurrence ? describeRecurrence(task.recurrence) : 'Does not repeat'}
            </Button>
          )}
        />
      )}
    >
      {({ close }) => <CustomEditor task={task} close={close} />}
    </Popover>
  )
}
