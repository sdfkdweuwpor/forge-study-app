import { useState } from 'react'
import { CalendarDays, Columns3, List } from 'lucide-react'
import { SegmentedControl, type SegmentOption } from '@/ui/SegmentedControl'
import type { DemoSection } from '../types'
import { Block, Cell, FORCE_STATES, Row, Stack, demo } from './Primitives.kit'

type Mode = 'pomodoro' | 'custom' | 'stopwatch'
type Layout = 'list' | 'board' | 'calendar'
type Range = 'week' | 'month' | 'year'

const MODES: SegmentOption<Mode>[] = [
  { value: 'pomodoro', label: 'Pomodoro' },
  { value: 'custom', label: 'Custom' },
  { value: 'stopwatch', label: 'Stopwatch' },
]

const LAYOUTS: SegmentOption<Layout>[] = [
  { value: 'list', icon: <List />, 'aria-label': 'List' },
  { value: 'board', icon: <Columns3 />, 'aria-label': 'Board' },
  { value: 'calendar', icon: <CalendarDays />, 'aria-label': 'Calendar' },
]

const RANGES: SegmentOption<Range>[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year', disabled: true },
]

function SegmentedDemo() {
  const [mode, setMode] = useState<Mode>('pomodoro')
  const [layout, setLayout] = useState<Layout>('list')
  return (
    <Stack>
      <Block caption="Click, or Tab in and use the arrow keys">
        <Row align="center">
          <SegmentedControl label="Timer mode" options={MODES} value={mode} onValueChange={setMode} />
          <SegmentedControl
            label="Tasks layout"
            options={LAYOUTS}
            value={layout}
            onValueChange={setLayout}
            size="sm"
          />
          <span className={demo.value}>
            <strong>{mode}</strong> · {layout}
          </span>
        </Row>
      </Block>

      <Block caption="States (forced on the unselected segments; focus on the selected one)">
        <Row align="start">
          {FORCE_STATES.map((s) => (
            <Cell key={s.label} label={s.label}>
              <SegmentedControl
                label={`Timer mode, ${s.label}`}
                options={MODES}
                defaultValue="custom"
                size="sm"
                data-force={s.force}
              />
            </Cell>
          ))}
          <Cell label="Disabled">
            <SegmentedControl label="Timer mode, disabled" options={MODES} defaultValue="custom" size="sm" disabled />
          </Cell>
        </Row>
      </Block>

      <Block caption="Full width, with one disabled option">
        <div className={demo.column}>
          <SegmentedControl label="Chart range" options={RANGES} defaultValue="week" fullWidth />
        </div>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'segmented-control',
  title: 'SegmentedControl',
  group: 'Primitives',
  order: 70,
  description: 'Two to four mutually exclusive options that switch a view or mode in place.',
  render: () => <SegmentedDemo />,
}

export default section
