import { useSettings } from '@/db/hooks/useSettings'
import { Toggle } from '@/ui/Toggle'
import { IntField } from './IntField'
import { Row } from './Row'
import { SaveStatusLine } from './SaveStatusLine'
import { FOCUS } from './sections'
import { SectionLoading, SettingsSection } from './SettingsSection'
import { useSaveSettings } from './useSaveSettings'

/** Limits match what the timer accepts (`normalizeCycle`), so a saved value is never quietly changed. */
export const FOCUS_LIMITS = {
  pomodoroMin: { min: 1, max: 240 },
  shortBreakMin: { min: 1, max: 120 },
  longBreakMin: { min: 1, max: 120 },
  longBreakEvery: { min: 1, max: 12 },
  dailyGoalPomodoros: { min: 1, max: 24 },
} as const

/** Timer defaults and the daily goal. The Focus page and the mini timer read these on the next session. */
export function FocusSection() {
  const settings = useSettings()
  const { save, status } = useSaveSettings()
  if (settings === undefined) return <SectionLoading title={FOCUS.title} rows={5} />
  const { timer } = settings
  const lim = FOCUS_LIMITS
  return (
    <SettingsSection
      title={FOCUS.title}
      intro="Defaults for the pomodoro timer. A session already running keeps its own length."
    >
      <Row label="Focus length" help="One pomodoro.">
        {(id) => (
          <IntField
            value={timer.pomodoroMin}
            {...lim.pomodoroMin}
            unit="min"
            labelledBy={id}
            onCommit={(pomodoroMin) => void save({ timer: { pomodoroMin } })}
          />
        )}
      </Row>
      <Row label="Short break">
        {(id) => (
          <IntField
            value={timer.shortBreakMin}
            {...lim.shortBreakMin}
            unit="min"
            labelledBy={id}
            onCommit={(shortBreakMin) => void save({ timer: { shortBreakMin } })}
          />
        )}
      </Row>
      <Row label="Long break">
        {(id) => (
          <IntField
            value={timer.longBreakMin}
            {...lim.longBreakMin}
            unit="min"
            labelledBy={id}
            onCommit={(longBreakMin) => void save({ timer: { longBreakMin } })}
          />
        )}
      </Row>
      <Row
        label="Rounds before a long break"
        help="Every Nth focus round is followed by the long break."
      >
        {(id) => (
          <IntField
            value={timer.longBreakEvery}
            {...lim.longBreakEvery}
            unit="rounds"
            labelledBy={id}
            onCommit={(longBreakEvery) => void save({ timer: { longBreakEvery } })}
          />
        )}
      </Row>
      <Row
        label="Start breaks automatically"
        help="The break begins as soon as a focus round ends."
      >
        {(id) => (
          <Toggle
            aria-labelledby={id}
            checked={timer.autoStartBreaks}
            onCheckedChange={(autoStartBreaks) => void save({ timer: { autoStartBreaks } })}
          />
        )}
      </Row>
      <Row
        label="Start the next focus round automatically"
        help="The next round begins as soon as a break ends."
      >
        {(id) => (
          <Toggle
            aria-labelledby={id}
            checked={timer.autoStartFocus}
            onCheckedChange={(autoStartFocus) => void save({ timer: { autoStartFocus } })}
          />
        )}
      </Row>
      <Row
        label="Daily goal"
        help="Pomodoros a day. Reaching it counts toward your streak and pays a bonus."
      >
        {(id) => (
          <IntField
            value={settings.dailyGoalPomodoros}
            {...lim.dailyGoalPomodoros}
            unit="pomodoros"
            labelledBy={id}
            onCommit={(dailyGoalPomodoros) => void save({ dailyGoalPomodoros })}
          />
        )}
      </Row>
      <SaveStatusLine status={status} />
    </SettingsSection>
  )
}
