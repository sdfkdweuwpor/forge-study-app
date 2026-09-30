import { useState } from 'react'
import { recordError } from '@/app/reportError'
import { setBlockerMode, setBlockerSchedule } from '@/db/repos/blocker'
import type { BlockWindow, BlockerMode } from '@/db/types'
import { describeDays } from '@/logic/blocker'
import { SegmentedControl, type SegmentOption } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { useBlockerSettings } from './queries'
import { ScheduleEditor } from './ScheduleEditor'
import { Section } from './Section'
import styles from './ModeSection.module.css'

type ShownMode = Exclude<BlockerMode, 'off'>

const OPTIONS: readonly SegmentOption<ShownMode>[] = [
  { value: 'focus', label: 'During focus' },
  { value: 'schedule', label: 'Scheduled' },
  { value: 'always', label: 'Always' },
]

const EXPLAIN: Record<ShownMode, string> = {
  focus:
    'Sites are blocked while a focus session is running, including a paused one. Breaks and the time between sessions are free.',
  schedule: 'Sites are blocked during the times below, whether or not a session is running.',
  always:
    'Sites stay blocked all the time. An emergency unlock is still there if you really need one.',
}

const isShown = (mode: BlockerMode): mode is ShownMode => mode !== 'off'

/** When the blocker is on: during focus sessions, at set times, or always. */
export function ModeSection() {
  const settings = useBlockerSettings()
  return (
    <Section
      id="mode"
      title="When to block"
      description="Choose when the sites on your list are out of reach."
    >
      {settings === undefined ? (
        <div
          className={styles.skeleton}
          role="status"
          aria-busy="true"
          aria-label="Loading blocker mode"
        >
          <Skeleton variant="block" width={320} height={32} />
          <Skeleton width="55%" />
        </div>
      ) : (
        <ModeBody mode={settings.mode} schedule={settings.schedule} />
      )}
    </Section>
  )
}

function ModeBody({ mode, schedule }: { mode: BlockerMode; schedule: BlockWindow[] }) {
  // The windows being edited. Saved ones are the valid subset, so a half-typed window stays here.
  const [draft, setDraft] = useState<BlockWindow[]>(() =>
    schedule.map((w) => ({ ...w, days: [...w.days] })),
  )

  const changeMode = (next: ShownMode) => {
    setBlockerMode(next).catch((e: unknown) => recordError(e, 'blocker.mode'))
  }
  const changeSchedule = (next: BlockWindow[]) => {
    setDraft(next)
    setBlockerSchedule(next).catch((e: unknown) => recordError(e, 'blocker.schedule'))
  }

  return (
    <div className={styles.body}>
      <SegmentedControl
        label="When to block"
        options={OPTIONS}
        value={isShown(mode) ? mode : undefined}
        onValueChange={changeMode}
      />
      <p className={styles.explain}>
        {isShown(mode) ? EXPLAIN[mode] : 'The blocker is switched off. Pick a mode to turn it on.'}
      </p>
      {mode === 'schedule' ? (
        <div className={styles.schedule}>
          <ScheduleEditor windows={draft} onChange={changeSchedule} />
          {draft.length > 0 ? (
            <p className={styles.summary}>
              Blocking{' '}
              {draft.map((w) => `${describeDays(w.days)} ${w.start} to ${w.end}`).join(' and ')}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
