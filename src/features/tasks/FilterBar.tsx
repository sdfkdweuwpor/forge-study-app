import { ArrowDownUp, Check, ListFilter } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Priority, TaskDueFilter, TaskSortKey, TaskStatus } from '@/db/types'
import { activeFilterCount, clearFilters, type TaskListView } from '@/logic/taskListView'
import type { TaskListId } from '@/logic/taskLists'
import type { TaskGroupBy } from '@/logic/taskQuery'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/Checkbox'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { Popover, PopoverBody } from '@/ui/Popover'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { PriorityFlag } from './PriorityFlag'
import { PRIORITIES, priorityLabel } from './priority'
import type { CourseInfo } from './queries'
import styles from './FilterBar.module.css'

const SORT_LABELS: Record<TaskSortKey, string> = {
  manual: 'Manual',
  due: 'Date',
  priority: 'Priority',
  created: 'Date added',
  updated: 'Last edited',
  title: 'Title',
  estimate: 'Estimate',
}
const SORT_ORDER: readonly TaskSortKey[] = [
  'manual',
  'due',
  'priority',
  'estimate',
  'title',
  'created',
  'updated',
]

const DUE_OPTIONS: ReadonlyArray<{ value: TaskDueFilter; label: string }> = [
  { value: 'overdue', label: 'Carried over' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'week', label: 'This week' },
  { value: 'upcoming', label: 'Later than today' },
  { value: 'none', label: 'No date' },
]

const STATUS_OPTIONS: ReadonlyArray<{ value: TaskStatus; label: string }> = [
  { value: 'todo', label: 'To do' },
  { value: 'doing', label: 'Doing' },
]

function toggle<T>(list: readonly T[] | undefined, value: T): T[] {
  const current = list ?? []
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
}

interface FilterPopoverProps {
  label: string
  count: number
  children: ReactNode
}

/** A filter button that opens a list of choices and says how many are on. */
function FilterPopover({ label, count, children }: FilterPopoverProps) {
  return (
    <Popover
      label={`Filter by ${label.toLowerCase()}`}
      side="bottom"
      align="start"
      trigger={(p) => (
        <Button
          {...p}
          variant="ghost"
          size="sm"
          className={styles.filter}
          data-active={count > 0 || undefined}
        >
          {count > 0 ? `${label} · ${count}` : label}
        </Button>
      )}
    >
      <PopoverBody>
        <div className={styles.options} role="group" aria-label={label}>
          {children}
        </div>
      </PopoverBody>
    </Popover>
  )
}

export interface FilterBarProps {
  list: TaskListId
  view: TaskListView
  onChange: (view: TaskListView) => void
  courses: readonly CourseInfo[]
  tags: readonly string[]
  /** Controls placed first in the bar (the layout switch). */
  leading?: ReactNode
  /** Controls placed last in the bar (Save view, Update and Reset). */
  trailing?: ReactNode
  /** Grouping means nothing to a board or a calendar. Default true. */
  showGroup?: boolean
  /** A calendar orders by time, so it has no sort. Default true. */
  showSort?: boolean
}

/** Grouping, sort and the five filters (status, priority, tag, course, due). Everything lives in the URL. */
export function FilterBar({
  list,
  view,
  onChange,
  courses,
  tags,
  leading,
  trailing,
  showGroup = true,
  showSort = true,
}: FilterBarProps) {
  const { filter } = view
  const count = activeFilterCount(filter)
  const completed = list === 'completed'
  const set = (patch: Partial<TaskListView['filter']>) =>
    onChange({ ...view, filter: { ...filter, ...patch } })

  const sortItems: MenuEntry[] = [
    { type: 'label', label: 'Sort by' },
    ...SORT_ORDER.map<MenuEntry>((key) => ({
      id: key,
      label: SORT_LABELS[key],
      icon: view.sort.key === key ? <Check /> : undefined,
      onSelect: () =>
        onChange({ ...view, sort: { key, dir: key === 'priority' ? 'desc' : 'asc' } }),
    })),
    ...(view.sort.key === 'manual'
      ? []
      : ([
          { type: 'separator', id: 'sep-dir' },
          {
            id: 'dir',
            label: view.sort.dir === 'asc' ? 'Reverse order' : 'Back to the usual order',
            onSelect: () =>
              onChange({
                ...view,
                sort: { ...view.sort, dir: view.sort.dir === 'asc' ? 'desc' : 'asc' },
              }),
          },
        ] satisfies MenuEntry[])),
  ]

  return (
    <div className={styles.bar} role="group" aria-label="Layout, group, sort and filter">
      {leading}
      {!completed && showGroup ? (
        <SegmentedControl<TaskGroupBy>
          label="Group by"
          size="sm"
          value={view.groupBy}
          onValueChange={(groupBy) => onChange({ ...view, groupBy })}
          options={[
            { value: 'date', label: 'Date' },
            { value: 'project', label: 'Project' },
            { value: 'none', label: 'None' },
          ]}
        />
      ) : null}

      {!completed && showSort ? (
        <>
          <Dropdown
            label="Sort"
            items={sortItems}
            trigger={(p) => (
              <Button {...p} variant="ghost" size="sm" iconLeft={<ArrowDownUp />}>
                {view.sort.key === 'manual' ? 'Sort' : `Sort: ${SORT_LABELS[view.sort.key]}`}
              </Button>
            )}
          />
          <span className={styles.divider} aria-hidden="true" />
        </>
      ) : null}
      <span className={styles.filterLabel}>
        <ListFilter size={14} aria-hidden="true" />
        <span className="sr-only">Filters</span>
      </span>

      {!completed ? (
        <FilterPopover label="Status" count={filter.status?.length ? 1 : 0}>
          {STATUS_OPTIONS.map((o) => (
            <Checkbox
              key={o.value}
              label={o.label}
              checked={filter.status?.includes(o.value) ?? false}
              onCheckedChange={() => set({ status: toggle(filter.status, o.value) })}
            />
          ))}
        </FilterPopover>
      ) : null}

      <FilterPopover label="Priority" count={filter.priority?.length ? 1 : 0}>
        {[...PRIORITIES].reverse().map((p: Priority) => (
          <Checkbox
            key={p}
            label={
              <span className={styles.priorityOption}>
                <PriorityFlag priority={p} />
                {priorityLabel(p)}
              </span>
            }
            checked={filter.priority?.includes(p) ?? false}
            onCheckedChange={() => set({ priority: toggle(filter.priority, p) })}
          />
        ))}
      </FilterPopover>

      {courses.length > 0 ? (
        <FilterPopover label="Course" count={filter.milestoneIds?.length ? 1 : 0}>
          {courses.map((c) => (
            <Checkbox
              key={c.id}
              label={c.label}
              checked={filter.milestoneIds?.includes(c.id) ?? false}
              onCheckedChange={() => set({ milestoneIds: toggle(filter.milestoneIds, c.id) })}
            />
          ))}
        </FilterPopover>
      ) : null}

      {tags.length > 0 ? (
        <FilterPopover label="Tag" count={filter.tags?.length ? 1 : 0}>
          {tags.map((tag) => (
            <Checkbox
              key={tag}
              label={tag}
              checked={filter.tags?.some((t) => t.toLowerCase() === tag.toLowerCase()) ?? false}
              onCheckedChange={() =>
                set({
                  tags: filter.tags?.some((t) => t.toLowerCase() === tag.toLowerCase())
                    ? filter.tags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
                    : [...(filter.tags ?? []), tag],
                })
              }
            />
          ))}
        </FilterPopover>
      ) : null}

      {!completed ? (
        <FilterPopover label="Date" count={filter.due && filter.due !== 'any' ? 1 : 0}>
          {DUE_OPTIONS.map((o) => (
            <Checkbox
              key={o.value}
              variant="round"
              label={o.label}
              checked={filter.due === o.value}
              onCheckedChange={() => set({ due: filter.due === o.value ? 'any' : o.value })}
            />
          ))}
        </FilterPopover>
      ) : null}

      {count > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(clearFilters(view))}>
          Clear
        </Button>
      ) : null}
      {trailing}
    </div>
  )
}
