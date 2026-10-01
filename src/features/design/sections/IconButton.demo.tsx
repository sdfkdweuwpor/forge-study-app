import { useState } from 'react'
import {
  GripVertical,
  MoreHorizontal,
  PanelLeftClose,
  Pin,
  Plus,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { IconButton, type IconButtonVariant } from '@/ui/IconButton'
import type { DemoSection } from '../types'
import { Block, Cell, FORCE_STATES, Row, Stack } from './Primitives.kit'

const VARIANTS: Array<{ variant: IconButtonVariant; caption: string }> = [
  { variant: 'ghost', caption: 'Ghost (default): row and toolbar actions' },
  { variant: 'secondary', caption: 'Secondary: standalone next to inputs' },
  { variant: 'primary', caption: 'Primary: the quick-add button' },
]

function MuteButton() {
  const [muted, setMuted] = useState(false)
  return (
    <IconButton
      label={muted ? 'Unmute ambient sound' : 'Mute ambient sound'}
      icon={muted ? <VolumeX /> : <Volume2 />}
      shortcut="m"
      pressed={muted}
      onClick={() => setMuted((m) => !m)}
    />
  )
}

function IconButtonDemo() {
  return (
    <Stack>
      {VARIANTS.map(({ variant, caption }) => (
        <Block key={variant} caption={caption}>
          <Row>
            {FORCE_STATES.map((s) => (
              <Cell key={s.label} label={s.label}>
                <IconButton
                  variant={variant}
                  label={variant === 'primary' ? 'New task' : 'More actions'}
                  icon={variant === 'primary' ? <Plus /> : <MoreHorizontal />}
                  data-force={s.force}
                />
              </Cell>
            ))}
            <Cell label="Disabled">
              <IconButton
                variant={variant}
                label="More actions"
                icon={variant === 'primary' ? <Plus /> : <MoreHorizontal />}
                disabled
              />
            </Cell>
          </Row>
        </Block>
      ))}

      <Block caption="Sizes: xs 24px (row handles), sm 28px (default), md 32px (beside a Button)">
        <Row align="center">
          <Cell label="xs">
            <IconButton size="xs" label="Drag to reorder" icon={<GripVertical />} />
          </Cell>
          <Cell label="sm">
            <IconButton label="More actions" icon={<MoreHorizontal />} />
          </Cell>
          <Cell label="md">
            <IconButton size="md" variant="secondary" label="More actions" icon={<MoreHorizontal />} />
          </Cell>
        </Row>
      </Block>

      <Block caption="Toggle buttons (aria-pressed) and tooltips with shortcuts: hover or Tab to them">
        <Row align="center">
          <Cell label="Pressed">
            <IconButton label="Pin to sidebar" icon={<Pin />} pressed />
          </Cell>
          <Cell label="Click to toggle">
            <MuteButton />
          </Cell>
          <Cell label="With shortcut">
            <IconButton label="Collapse sidebar" icon={<PanelLeftClose />} shortcut="mod+\" />
          </Cell>
          <Cell label="Quick add">
            <IconButton variant="primary" size="md" label="New task" icon={<Plus />} shortcut="q" />
          </Cell>
        </Row>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'icon-button',
  title: 'IconButton',
  group: 'Primitives',
  order: 20,
  description:
    'Icon-only actions. The label is required: it is the accessible name and the tooltip.',
  render: () => <IconButtonDemo />,
}

export default section
