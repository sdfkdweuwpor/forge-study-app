import { useState, type CSSProperties } from 'react'
import { Checkbox } from '@/ui/Checkbox'
import type { DemoSection } from '../types'
import { Block, Cell, FORCE_STATES, Row, Stack, demo } from './Primitives.kit'
import styles from './Checkbox.demo.module.css'

const TASKS = [
  { id: 'c182', title: 'Read chapter 4 of C182', xp: 15 },
  { id: 'd278', title: 'Watch D278 lecture 3', xp: 10 },
  { id: 'cards', title: 'Review 18 flashcards', xp: 15 },
]

/** The Phase 3 motion hook in action: "+XP" appears only after the fill has finished. */
function TaskList() {
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [settled, setSettled] = useState<Record<string, boolean>>({})
  return (
    <ul className={styles.tasks}>
      {TASKS.map((t) => (
        <li key={t.id} className={styles.task} data-done={done[t.id] || undefined}>
          <Checkbox
            variant="round"
            aria-label={`Complete “${t.title}”`}
            checked={!!done[t.id]}
            onCheckedChange={(on) => {
              setDone((d) => ({ ...d, [t.id]: on }))
              if (!on) setSettled((s) => ({ ...s, [t.id]: false }))
            }}
            onCheckAnimationEnd={() => setSettled((s) => ({ ...s, [t.id]: true }))}
          />
          <span className={styles.title}>{t.title}</span>
          {settled[t.id] && done[t.id] && <span className={styles.xp}>+{t.xp} XP</span>}
        </li>
      ))}
    </ul>
  )
}

function Matrix({ variant }: { variant: 'round' | 'square' }) {
  const states = [
    { label: 'Unchecked', checked: false, indeterminate: false },
    { label: 'Checked', checked: true, indeterminate: false },
    { label: 'Mixed', checked: false, indeterminate: true },
  ]
  return (
    <>
      {states.map((st) => (
        <Row key={st.label} align="center">
          <span className={styles.rowLabel}>{st.label}</span>
          {FORCE_STATES.map((f) => (
            <Cell key={f.label} label={f.label}>
              <Checkbox
                variant={variant}
                aria-label={`${st.label}, ${f.label}`}
                checked={st.checked}
                indeterminate={st.indeterminate}
                readOnly
                data-force={f.force}
              />
            </Cell>
          ))}
          <Cell label="Disabled">
            <Checkbox
              variant={variant}
              aria-label={`${st.label}, disabled`}
              checked={st.checked}
              indeterminate={st.indeterminate}
              readOnly
              disabled
            />
          </Cell>
        </Row>
      ))}
    </>
  )
}

function CheckboxDemo() {
  return (
    <Stack>
      <Block caption="Round, for tasks: click one. The rim fills inward, the tick draws, then the row reacts.">
        <div className={demo.stage}>
          <TaskList />
        </div>
      </Block>

      <Block caption="Round × states (hover previews the tick)">
        <Matrix variant="round" />
      </Block>

      <Block caption="Square, for settings and lists">
        <Matrix variant="square" />
      </Block>

      <Block caption="With labels, and a per-instance colour (--cb-color) for priority">
        <div className={demo.column}>
          <Checkbox label="Show week numbers in the calendar" defaultChecked />
          <Checkbox label="Count breaks toward the daily goal" />
          <Checkbox label="Sync with Google Calendar (coming later)" disabled />
          <Checkbox
            variant="round"
            label="Submit C182 objective assessment"
            defaultChecked
            style={{ '--cb-color': 'var(--danger)' } as CSSProperties}
          />
        </div>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'checkbox',
  title: 'Checkbox',
  group: 'Primitives',
  order: 50,
  description:
    'Round for tasks, square for settings. onCheckAnimationEnd lets task completion chain its motion.',
  render: () => <CheckboxDemo />,
}

export default section
