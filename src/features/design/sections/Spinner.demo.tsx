import { Spinner } from '@/ui/Spinner'
import type { DemoSection } from '../types'
import { Block, Cell, Row, Stack, demo } from './Primitives.kit'

function SpinnerDemo() {
  return (
    <Stack>
      <Block caption="Sizes, in the current text colour (a pulse with reduced motion)">
        <Row align="center">
          <Cell label="12">
            <Spinner size={12} />
          </Cell>
          <Cell label="16">
            <Spinner />
          </Cell>
          <Cell label="24">
            <Spinner size={24} />
          </Cell>
          <Cell label="Muted, with a status">
            <span className={demo.note} style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <Spinner size={14} label="Syncing" /> Syncing with the extension…
            </span>
          </Cell>
        </Row>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'spinner',
  title: 'Spinner',
  group: 'Primitives',
  order: 145,
  description: 'Short waits inside a control. Prefer Skeleton for content that is loading.',
  render: () => <SpinnerDemo />,
}

export default section
