import { useState } from 'react'
import { Check, Flame } from 'lucide-react'
import { Button } from '@/ui/Button'
import { ProgressRing } from '@/ui/ProgressRing'
import type { DemoSection } from '../types'
import { Block, Cell, Row, Stack } from './Primitives.kit'

function Pomodoros() {
  const [done, setDone] = useState(3)
  return (
    <Row align="center">
      <ProgressRing
        value={done}
        max={4}
        size={64}
        stroke={6}
        label="Pomodoros today"
        valueText={`${done} of 4 pomodoros`}
      >
        {done}/4
      </ProgressRing>
      <Button size="sm" onClick={() => setDone((d) => (d >= 4 ? 0 : d + 1))}>
        {done >= 4 ? 'Reset' : 'Finish a pomodoro'}
      </Button>
    </Row>
  )
}

function ProgressRingDemo() {
  return (
    <Stack>
      <Block caption="Sizes and strokes">
        <Row align="center">
          <Cell label="16 / 2">
            <ProgressRing value={70} size={16} stroke={2} label="Subtasks" />
          </Cell>
          <Cell label="24 / 3">
            <ProgressRing value={45} size={24} stroke={3} label="Unit 4" />
          </Cell>
          <Cell label="40 / 4">
            <ProgressRing value={62} label="C182">
              62
            </ProgressRing>
          </Cell>
          <Cell label="96 / 8">
            <ProgressRing value={80} size={96} stroke={8} label="Daily goal" valueText="96 of 120 minutes">
              <span style={{ fontSize: 'var(--fs-20)' }}>96m</span>
            </ProgressRing>
          </Cell>
        </Row>
      </Block>

      <Block caption="Tones, empty and complete">
        <Row align="center">
          <Cell label="0%">
            <ProgressRing value={0} label="Not started" />
          </Cell>
          <Cell label="success">
            <ProgressRing value={100} tone="success" label="Daily goal met">
              <Check size={16} aria-hidden="true" />
            </ProgressRing>
          </Cell>
          <Cell label="xp">
            <ProgressRing value={67} tone="xp" label="Level 7 progress">
              <Flame size={16} aria-hidden="true" />
            </ProgressRing>
          </Cell>
          <Cell label="warning">
            <ProgressRing value={30} tone="warning" label="Behind plan" />
          </Cell>
        </Row>
      </Block>

      <Block caption="Animated value (aria-valuenow updates with it)">
        <Pomodoros />
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'progress-ring',
  title: 'ProgressRing',
  group: 'Primitives',
  order: 130,
  description: 'Compact progress for daily goals, pomodoros and course cards.',
  render: () => <ProgressRingDemo />,
}

export default section
