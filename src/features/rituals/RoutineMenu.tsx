import { ListPlus } from 'lucide-react'
import { useMemo } from 'react'
import type { ISODate } from '@/db/types'
import { routineMinutes, type RoutineEntry } from '@/logic/routines'
import { durationText } from '@/logic/statsLabels'
import { Button } from '@/ui/Button'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { useRoutineEntries } from './queries'
import { useRitualActions } from './actions'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** "Study day · 4 tasks · 1 h 50 min" for a menu row or a list. */
export function routineSummary(entry: RoutineEntry): string {
  const minutes = routineMinutes(entry.payload)
  const count = plural(entry.payload.tasks.length, 'task')
  return minutes > 0 ? `${count} · ${durationText(minutes)}` : count
}

/**
 * "Add a routine": a menu of your routines and the built-in starters. Choosing one adds its tasks to
 * `day` at once, with a toast that undoes it.
 */
export function RoutineMenu({ day, today }: { day: ISODate; today: ISODate }) {
  const entries = useRoutineEntries()
  const actions = useRitualActions()

  const items = useMemo<MenuEntry[]>(() => {
    if (entries === undefined) return []
    const out: MenuEntry[] = []
    const mine = entries.filter((e) => !e.builtIn)
    const starters = entries.filter((e) => e.builtIn)
    const row = (e: RoutineEntry): MenuEntry => ({
      id: e.id,
      label: `${e.icon} ${e.name} · ${routineSummary(e)}`,
      onSelect: () => void actions.apply(e, day, today),
    })
    if (mine.length > 0) {
      out.push({ type: 'label', label: 'Your routines' }, ...mine.map(row))
      out.push({ type: 'separator', id: 'sep-starters' })
    }
    out.push({ type: 'label', label: 'Starters' }, ...starters.map(row))
    return out
  }, [entries, actions, day, today])

  return (
    <Dropdown
      label="Add a routine"
      items={items}
      emptyLabel="No routines yet"
      trigger={(p) => (
        <Button
          {...p}
          variant="ghost"
          size="sm"
          iconLeft={<ListPlus />}
          disabled={entries === undefined}
        >
          Add a routine
        </Button>
      )}
    />
  )
}
