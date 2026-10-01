import { useSettings } from '@/db/hooks/useSettings'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Row } from './Row'
import { SaveStatusLine } from './SaveStatusLine'
import { CALENDAR } from './sections'
import { SectionLoading, SettingsSection } from './SettingsSection'
import { useSaveSettings } from './useSaveSettings'

type WeekStart = '1' | '0'

const OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '0', label: 'Sunday' },
] as const

/** Which day a week starts on: the calendar, the planner, streak freezes and the weekly review all follow it. */
export function CalendarSection() {
  const settings = useSettings()
  const { save, status } = useSaveSettings()
  if (settings === undefined) return <SectionLoading title={CALENDAR.title} rows={1} />
  return (
    <SettingsSection title={CALENDAR.title}>
      <Row
        label="Week starts on"
        help="The calendar, the planner, the weekly review and your weekly streak freeze count weeks from this day."
      >
        {() => (
          <SegmentedControl<WeekStart>
            label="Week starts on"
            size="sm"
            options={OPTIONS}
            value={String(settings.weekStartsOn) as WeekStart}
            onValueChange={(v) => void save({ weekStartsOn: v === '0' ? 0 : 1 })}
          />
        )}
      </Row>
      <SaveStatusLine status={status} />
    </SettingsSection>
  )
}
