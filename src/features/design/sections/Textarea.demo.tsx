import { useState } from 'react'
import { Textarea } from '@/ui/Textarea'
import type { DemoSection } from '../types'
import { Block, Cell, Row, Stack, demo } from './Primitives.kit'

const REFLECTION =
  'Subnetting finally clicked: borrow bits from the host part, count the networks, then the hosts. ' +
  'Still shaky on IPv6 shorthand. Tomorrow: 20 practice questions before the C182 objective assessment.'

function GrowingNotes() {
  const [text, setText] = useState(REFLECTION)
  return (
    <Textarea
      label="Session notes"
      value={text}
      onChange={(e) => setText(e.target.value)}
      minRows={2}
      maxRows={8}
      hint={`${text.length} characters. Grows to 8 lines, then scrolls.`}
    />
  )
}

function TextareaDemo() {
  const w = { width: 260 }
  return (
    <Stack>
      <Block caption="Auto-grow: type or paste; it grows line by line">
        <div className={demo.column}>
          <GrowingNotes />
        </div>
      </Block>

      <Block caption="States">
        <Row align="start">
          <Cell label="Rest">
            <div style={w}>
              <Textarea aria-label="Note" placeholder="What did you learn in Unit 4?" minRows={2} />
            </div>
          </Cell>
          <Cell label="Hover">
            <div style={w}>
              <Textarea aria-label="Note" placeholder="What did you learn in Unit 4?" minRows={2} data-force="hover" />
            </div>
          </Cell>
          <Cell label="Focus">
            <div style={w}>
              <Textarea aria-label="Note" defaultValue="Review the OSI model" minRows={2} data-force="focus" />
            </div>
          </Cell>
          <Cell label="Error">
            <div style={w}>
              <Textarea
                aria-label="Plan JSON"
                defaultValue='{ "courses": [ '
                minRows={2}
                error="Line 1: unexpected end of JSON"
              />
            </div>
          </Cell>
          <Cell label="Disabled">
            <div style={w}>
              <Textarea aria-label="Note" defaultValue="Archived with the goal" minRows={2} disabled />
            </div>
          </Cell>
        </Row>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'textarea',
  title: 'Textarea',
  group: 'Primitives',
  order: 40,
  description: 'Multi-line text that grows with its content, up to an optional maximum.',
  render: () => <TextareaDemo />,
}

export default section
