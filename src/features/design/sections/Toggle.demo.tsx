import { useState } from 'react'
import { Toggle } from '@/ui/Toggle'
import type { DemoSection } from '../types'
import { Block, Cell, FORCE_STATES, Row, Stack, demo } from './Primitives.kit'

function SettingsRows() {
  const [chime, setChime] = useState(true)
  const [motion, setMotion] = useState(false)
  return (
    <div className={demo.column}>
      <Toggle label="Play a chime when a session ends" checked={chime} onCheckedChange={setChime} />
      <Toggle label="Reduce motion" checked={motion} onCheckedChange={setMotion} />
      <Toggle label="Block sites during breaks" labelPosition="start" size="sm" />
      <Toggle label="Sync across devices (Phase 12)" disabled />
    </div>
  )
}

function ToggleDemo() {
  return (
    <Stack>
      {(['md', 'sm'] as const).map((size) =>
        [false, true].map((on) => (
          <Block key={`${size}-${on}`} caption={`${size === 'md' ? 'md 32×18' : 'sm 26×14'}, ${on ? 'on' : 'off'}`}>
            <Row align="center">
              {FORCE_STATES.map((s) => (
                <Cell key={s.label} label={s.label}>
                  <Toggle
                    size={size}
                    aria-label={`Example, ${s.label}`}
                    checked={on}
                    data-force={s.force}
                  />
                </Cell>
              ))}
              <Cell label="Disabled">
                <Toggle size={size} aria-label="Example, disabled" checked={on} disabled />
              </Cell>
            </Row>
          </Block>
        )),
      )}

      <Block caption="With labels: click the text or the switch; Space toggles">
        <SettingsRows />
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'toggle',
  title: 'Toggle',
  group: 'Primitives',
  order: 60,
  description: 'An on/off setting that applies at once (role="switch"). Use a Checkbox inside forms.',
  render: () => <ToggleDemo />,
}

export default section
