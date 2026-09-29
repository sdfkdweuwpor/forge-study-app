import { useState } from 'react'
import { Clock, Hash, Search, X } from 'lucide-react'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import { Kbd } from '@/ui/Kbd'
import type { DemoSection } from '../types'
import { Block, Cell, Row, Stack, demo } from './Primitives.kit'

const COURSE = /^[A-Z]\d{3}$/

function CourseCodeField() {
  const [code, setCode] = useState('C18')
  const valid = COURSE.test(code)
  return (
    <Input
      label="Course code"
      value={code}
      onChange={(e) => setCode(e.target.value.toUpperCase())}
      leadingIcon={<Hash />}
      hint="As it appears on your WGU degree plan"
      error={!valid && code.length > 0 ? 'Use a letter and three digits, like C182' : undefined}
      maxLength={4}
      autoComplete="off"
    />
  )
}

function SearchField() {
  const [q, setQ] = useState('')
  return (
    <Input
      aria-label="Search tasks"
      placeholder="Search tasks…"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      leadingIcon={<Search />}
      trailing={
        q ? (
          <IconButton size="xs" label="Clear search" icon={<X />} onClick={() => setQ('')} />
        ) : (
          <Kbd keys="/" size="sm" />
        )
      }
    />
  )
}

function InputDemo() {
  const w = { width: 240 }
  return (
    <Stack>
      <Block caption="States">
        <Row align="start">
          <Cell label="Rest">
            <div style={w}>
              <Input aria-label="Task title" placeholder="Read chapter 4" />
            </div>
          </Cell>
          <Cell label="Hover">
            <div style={w}>
              <Input aria-label="Task title" placeholder="Read chapter 4" data-force="hover" />
            </div>
          </Cell>
          <Cell label="Focus">
            <div style={w}>
              <Input aria-label="Task title" defaultValue="Read chapter 4" data-force="focus" />
            </div>
          </Cell>
          <Cell label="Invalid">
            <div style={w}>
              <Input aria-label="Daily minutes" defaultValue="0" invalid />
            </div>
          </Cell>
          <Cell label="Disabled">
            <div style={w}>
              <Input aria-label="Goal" defaultValue="WGU B.S. Computer Science" disabled />
            </div>
          </Cell>
        </Row>
      </Block>

      <Block caption="Label, hint and error (type to validate), leading icon, trailing slot">
        <div className={demo.split}>
          <CourseCodeField />
          <Input
            label="Focus length"
            type="number"
            defaultValue={25}
            min={5}
            max={120}
            leadingIcon={<Clock />}
            trailing={<span className={demo.value}>min</span>}
            hint="5 to 120 minutes"
          />
          <Input
            label="Target date"
            defaultValue="Dec 15"
            error="That is before the course starts (Jan 6)"
          />
        </div>
      </Block>

      <Block caption="Search with a clear button; sizes md 32px and sm 28px">
        <div className={demo.split}>
          <SearchField />
          <Input size="sm" aria-label="Filter" placeholder="Filter by tag" leadingIcon={<Hash />} />
        </div>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'input',
  title: 'Input',
  group: 'Primitives',
  order: 30,
  description: 'Single-line text with optional label, leading icon, trailing slot, hint and error.',
  render: () => <InputDemo />,
}

export default section
