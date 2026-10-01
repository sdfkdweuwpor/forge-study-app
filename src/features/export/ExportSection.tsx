import { useId, useState } from 'react'
import { Download, Copy } from 'lucide-react'
import type { MarkdownGrouping, TaskScope } from '@/logic/export'
import { Button, Checkbox, SegmentedControl, Skeleton, Toggle } from '@/ui'
import {
  copyCalendar,
  copyTasksMarkdown,
  DEFAULT_CALENDAR_EXPORT,
  DEFAULT_TASK_EXPORT,
  downloadCalendar,
  exportTasksCsv,
  exportTasksMarkdown,
  type ExportOutcome,
} from './actions'
import styles from './export.module.css'
import { useExportGoals } from './queries'

const SCOPES: { value: TaskScope; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
]
const GROUPS: { value: MarkdownGrouping; label: string }[] = [
  { value: 'date', label: 'By date' },
  { value: 'goal', label: 'By goal' },
]
const RANGES: { value: string; label: string }[] = [
  { value: 'all', label: 'All upcoming' },
  { value: '4', label: '4 weeks' },
  { value: '8', label: '8 weeks' },
  { value: '13', label: '13 weeks' },
]

/** Settings section (slot `settings.sections`): tasks as CSV or Markdown, the calendar as `.ics`. */
export function ExportSection() {
  const headingId = useId()
  const goals = useExportGoals()
  const [scope, setScope] = useState<TaskScope>(DEFAULT_TASK_EXPORT.scope)
  const [groupBy, setGroupBy] = useState<MarkdownGrouping>(DEFAULT_TASK_EXPORT.groupBy)
  const [everyday, setEveryday] = useState(DEFAULT_CALENDAR_EXPORT.includeEveryday)
  const [deadlines, setDeadlines] = useState(DEFAULT_CALENDAR_EXPORT.includeDeadlines)
  const [range, setRange] = useState('all')
  /** Goals left out; everything is in by default, so new goals join automatically. */
  const [skipped, setSkipped] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<ExportOutcome | null>(null)

  const taskOpts = { scope, groupBy }
  const includedGoals = (goals ?? []).filter((g) => !skipped.includes(g.id)).map((g) => g.id)
  const allIncluded = goals !== undefined && includedGoals.length === goals.length
  const calOpts = {
    goalIds: allIncluded ? [] : includedGoals,
    includeEveryday: everyday,
    includeDeadlines: deadlines,
    weeks: range === 'all' ? null : Number(range),
  }
  const nothingPicked = goals !== undefined && goals.length > 0 && includedGoals.length === 0

  async function run(id: string, job: () => Promise<ExportOutcome>): Promise<void> {
    setBusy(id)
    setStatus(await job())
    setBusy(null)
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Export &amp; calendar
      </h2>
      <p className={styles.help}>
        Everything is built on this device from your local data, so it works offline.
      </p>

      <div className={styles.group}>
        <h3 className={styles.subheading}>Tasks</h3>
        <div className={styles.row}>
          <span className={styles.label}>Which tasks</span>
          <SegmentedControl
            label="Which tasks"
            options={SCOPES}
            value={scope}
            onValueChange={setScope}
            size="sm"
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Markdown grouping</span>
          <SegmentedControl
            label="Markdown grouping"
            options={GROUPS}
            value={groupBy}
            onValueChange={setGroupBy}
            size="sm"
          />
        </div>
        <div className={styles.actions}>
          <Button
            iconLeft={<Download />}
            loading={busy === 'csv'}
            onClick={() => void run('csv', () => exportTasksCsv(taskOpts))}
          >
            Tasks as CSV
          </Button>
          <Button
            iconLeft={<Download />}
            loading={busy === 'md'}
            onClick={() => void run('md', () => exportTasksMarkdown(taskOpts))}
          >
            Tasks as Markdown
          </Button>
          <Button
            variant="ghost"
            iconLeft={<Copy />}
            loading={busy === 'mdcopy'}
            onClick={() => void run('mdcopy', () => copyTasksMarkdown(taskOpts))}
          >
            Copy as text
          </Button>
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.subheading}>Calendar</h3>
        <p className={styles.help}>
          Study blocks, course targets and planned exams, as an .ics file.
        </p>
        {goals === undefined ? (
          <Skeleton height={20} width="60%" />
        ) : (
          goals.length > 1 && (
            <fieldset className={styles.goals}>
              <legend className={styles.label}>Goals</legend>
              {goals.map((g) => (
                <Checkbox
                  key={g.id}
                  label={g.title}
                  checked={!skipped.includes(g.id)}
                  onCheckedChange={(on) =>
                    setSkipped((s) => (on ? s.filter((x) => x !== g.id) : [...s, g.id]))
                  }
                />
              ))}
            </fieldset>
          )
        )}
        <div className={styles.row}>
          <Toggle
            label="Include everyday tasks that have a time"
            checked={everyday}
            onCheckedChange={setEveryday}
          />
        </div>
        <div className={styles.row}>
          <Toggle
            label="Include task deadlines as all-day events"
            checked={deadlines}
            onCheckedChange={setDeadlines}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Range</span>
          <SegmentedControl
            label="Calendar range"
            options={RANGES}
            value={range}
            onValueChange={setRange}
            size="sm"
          />
        </div>
        <div className={styles.actions}>
          <Button
            variant="primary"
            iconLeft={<Download />}
            disabled={nothingPicked}
            loading={busy === 'ics'}
            onClick={() => void run('ics', () => downloadCalendar(calOpts))}
          >
            Calendar (.ics)
          </Button>
          <Button
            variant="ghost"
            iconLeft={<Copy />}
            disabled={nothingPicked}
            loading={busy === 'icscopy'}
            onClick={() => void run('icscopy', () => copyCalendar(calOpts))}
          >
            Copy calendar data
          </Button>
        </div>
        <p className={styles.help}>
          Google Calendar: Settings, Import &amp; export, choose the file. Apple Calendar: File,
          Import. Save copied data as a .ics file first. Times are your local time; re-importing
          updates events instead of duplicating them.
        </p>
      </div>

      <p
        className={styles.status}
        role="status"
        data-tone={status?.ok === false ? 'error' : undefined}
      >
        {status?.message ?? ''}
      </p>
    </section>
  )
}
