import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Layers, Play, Plus, Trash2 } from 'lucide-react'
import { Button, type ButtonVariant } from '@/ui/Button'
import type { DemoSection } from '../types'
import { Block, Cell, FORCE_STATES, Row, Stack } from './Primitives.kit'

const VARIANTS: Array<{ variant: ButtonVariant; label: string; icon: ReactNode }> = [
  { variant: 'primary', label: 'Start focus', icon: <Play /> },
  { variant: 'secondary', label: 'New task', icon: <Plus /> },
  { variant: 'ghost', label: 'Review 18 cards', icon: <Layers /> },
  { variant: 'danger', label: 'Delete goal', icon: <Trash2 /> },
]

function SaveButton() {
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!saving) return
    const t = window.setTimeout(() => setSaving(false), 1400)
    return () => window.clearTimeout(t)
  }, [saving])
  return (
    <Button variant="primary" loading={saving} onClick={() => setSaving(true)}>
      Save plan
    </Button>
  )
}

function ButtonDemo() {
  return (
    <Stack>
      {VARIANTS.map(({ variant, label, icon }) => (
        <Block key={variant} caption={variant[0]!.toUpperCase() + variant.slice(1)}>
          <Row>
            {FORCE_STATES.map((s) => (
              <Cell key={s.label} label={s.label}>
                <Button variant={variant} iconLeft={icon} data-force={s.force}>
                  {label}
                </Button>
              </Cell>
            ))}
            <Cell label="Disabled">
              <Button variant={variant} iconLeft={icon} disabled>
                {label}
              </Button>
            </Cell>
            <Cell label="Loading">
              <Button variant={variant} iconLeft={icon} loading>
                {label}
              </Button>
            </Cell>
          </Row>
        </Block>
      ))}

      <Block caption="Sizes: md 32px, sm 28px (both get a 44px hit area on touch)">
        <Row>
          <Cell label="md">
            <Button variant="primary">Start focus</Button>
          </Cell>
          <Cell label="sm">
            <Button variant="primary" size="sm">
              Start focus
            </Button>
          </Cell>
          <Cell label="sm secondary">
            <Button size="sm" iconLeft={<Plus />}>
              Add subtask
            </Button>
          </Cell>
          <Cell label="sm ghost">
            <Button size="sm" variant="ghost">
              Skip for today
            </Button>
          </Cell>
        </Row>
      </Block>

      <Block caption="Icons: left, right, text only">
        <Row>
          <Cell label="Icon left">
            <Button iconLeft={<Plus />}>New goal</Button>
          </Cell>
          <Cell label="Icon right">
            <Button iconRight={<ArrowRight />}>Continue to schedule</Button>
          </Cell>
          <Cell label="Text only">
            <Button>Cancel</Button>
          </Cell>
        </Row>
      </Block>

      <Block caption="Full width, and loading on click (keeps its width and focus)">
        <Row>
          <div style={{ width: '100%', maxWidth: 320 }}>
            <Button variant="primary" fullWidth iconLeft={<Play />}>
              Start 25-minute focus
            </Button>
          </div>
          <SaveButton />
        </Row>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'button',
  title: 'Button',
  group: 'Primitives',
  order: 10,
  description:
    'One primary action per surface; secondary by default; ghost in toolbars and rows; danger for destructive confirms.',
  render: () => <ButtonDemo />,
}

export default section
