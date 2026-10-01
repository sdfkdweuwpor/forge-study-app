import { Check, ChevronDown } from 'lucide-react'
import type { Task } from '@/db/types'
import { Button } from '@/ui/Button'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { useTaskEnv } from './TaskActions'
import { linkTask, useProjectOptions } from './TaskPanels'

/** The Goal / course property: a menu of your goals and their courses, or none. */
export function ProjectField({ task }: { task: Pick<Task, 'id' | 'goalId' | 'milestoneId'> }) {
  const { projects } = useTaskEnv()
  const options = useProjectOptions(task)

  const course = task.milestoneId ? projects?.courseById.get(task.milestoneId) : undefined
  const goal = task.goalId ? projects?.goalById.get(task.goalId) : undefined
  const label = course ? course.label : goal ? goal.title : 'None'

  const items: MenuEntry[] = options.map((o) =>
    o.heading
      ? { type: 'label', label: String(o.label) }
      : {
          id: o.key,
          label: String(o.label),
          icon: o.current ? <Check /> : undefined,
          onSelect: () => void linkTask(task.id, o.goalId, o.milestoneId),
        },
  )

  if (projects && projects.goals.length === 0) {
    return (
      <Button variant="secondary" size="sm" disabled>
        No goals yet
      </Button>
    )
  }

  return (
    <Dropdown
      label="Goal or course"
      items={items}
      trigger={(p) => (
        <Button {...p} variant="secondary" size="sm" iconRight={<ChevronDown />}>
          {label}
        </Button>
      )}
    />
  )
}
