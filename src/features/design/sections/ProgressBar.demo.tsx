import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { IconButton } from '@/ui/IconButton'
import { ProgressBar, type ProgressTone } from '@/ui/ProgressBar'
import type { DemoSection } from '../types'
import { Block, Row, Stack, demo } from './Primitives.kit'

const TONES: Array<{ tone: ProgressTone; label: string; value: number }> = [
  { tone: 'accent', label: 'C182 Introduction to IT', value: 62 },
  { tone: 'success', label: 'D278 Scripting and Programming', value: 100 },
  { tone: 'warning', label: 'C779 Web Development (behind plan)', value: 35 },
  { tone: 'danger', label: 'C959 Discrete Math I (overdue)', value: 12 },
]

function XpBar() {
  const [xp, setXp] = useState(1240)
  const max = 1852
  return (
    <div className={demo.column}>
      <Row align="center">
        <span className={demo.value}>
          Level 7 · <strong>{xp.toLocaleString('en-US')}</strong> / {max.toLocaleString('en-US')} XP
        </span>
        <IconButton size="xs" label="Remove 150 XP" icon={<Minus />} onClick={() => setXp((v) => Math.max(0, v - 150))} />
        <IconButton size="xs" label="Add 150 XP" icon={<Plus />} onClick={() => setXp((v) => Math.min(max, v + 150))} />
      </Row>
      <ProgressBar
        tone="xp"
        value={xp}
        max={max}
        label="Level 7 progress"
        valueText={`${xp} of ${max} XP`}
      />
    </div>
  )
}

function ProgressBarDemo() {
  return (
    <Stack>
      <Block caption="Tones: accent for progress, status colours when it means something">
        <div className={demo.column}>
          {TONES.map((t) => (
            <div key={t.tone} className={demo.block}>
              <span className={demo.value}>
                {t.label} · <strong>{t.value}%</strong>
              </span>
              <ProgressBar tone={t.tone} value={t.value} label={t.label} />
            </div>
          ))}
        </div>
      </Block>

      <Block caption="XP (gold, for XP and rewards only): press + to watch it ease">
        <XpBar />
      </Block>

      <Block caption="Sizes sm 4px, md 6px, lg 8px; 0%; indeterminate">
        <div className={demo.column}>
          <ProgressBar size="sm" value={40} label="Small" />
          <ProgressBar size="md" value={40} label="Medium" />
          <ProgressBar size="lg" value={40} label="Large" />
          <ProgressBar value={0} label="Not started" />
          <ProgressBar label="Importing plan" />
        </div>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'progress-bar',
  title: 'ProgressBar',
  group: 'Primitives',
  order: 120,
  description: 'Linear progress toward a known total. Gold is reserved for XP.',
  render: () => <ProgressBarDemo />,
}

export default section
