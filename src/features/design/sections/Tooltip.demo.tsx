import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pause, Play, SkipForward } from 'lucide-react'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'
import { Tooltip, TooltipBubble } from '@/ui/Tooltip'
import type { DemoSection } from '../types'
import { Block, Cell, Row, Stack } from './Primitives.kit'

function TooltipDemo() {
  return (
    <Stack>
      <Block caption="The bubble: text, text with a shortcut, and a long line that wraps at 260px">
        <Row align="start">
          <TooltipBubble content="Collapse sidebar" />
          <TooltipBubble content="Start focus" shortcut="shift+s" />
          <TooltipBubble content="Command palette" shortcut="mod+k" />
          <TooltipBubble content="Rebalance moves unfinished chunks forward without breaking prerequisites" />
        </Row>
      </Block>

      <Block caption="Live: hover (500ms delay, then instant between neighbours) or Tab to focus; Esc dismisses; flips at the viewport edge">
        <Row align="center">
          <Tooltip content="Top (default)">
            <Button iconLeft={<ArrowUp />}>Top</Button>
          </Tooltip>
          <Tooltip content="Bottom" side="bottom">
            <Button iconLeft={<ArrowDown />}>Bottom</Button>
          </Tooltip>
          <Tooltip content="Left" side="left">
            <Button iconLeft={<ArrowLeft />}>Left</Button>
          </Tooltip>
          <Tooltip content="Right" side="right">
            <Button iconLeft={<ArrowRight />}>Right</Button>
          </Tooltip>
        </Row>
      </Block>

      <Block caption="On icon buttons (the label is the tooltip; the shortcut is also exposed as aria-keyshortcuts)">
        <Row align="center">
          <Cell label="Start">
            <IconButton label="Start" icon={<Play />} shortcut="space" />
          </Cell>
          <Cell label="Pause">
            <IconButton label="Pause" icon={<Pause />} shortcut="space" />
          </Cell>
          <Cell label="Skip">
            <IconButton label="Skip to next phase" icon={<SkipForward />} shortcut="shift+n" />
          </Cell>
          <Cell label="Described">
            <Tooltip content="Due today at 2 pm · 2 pomodoros">
              <Button variant="ghost">Read chapter 4</Button>
            </Tooltip>
          </Cell>
        </Row>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'tooltip',
  title: 'Tooltip',
  group: 'Primitives',
  order: 110,
  description: 'Names icon buttons and teaches shortcuts. Never holds information found nowhere else.',
  render: () => <TooltipDemo />,
}

export default section
