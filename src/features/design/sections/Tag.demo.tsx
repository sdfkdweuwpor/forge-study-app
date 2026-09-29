import { useState } from 'react'
import { Hash } from 'lucide-react'
import { Button } from '@/ui/Button'
import { Tag, TAG_COLORS, type TagColor } from '@/ui/Tag'
import type { DemoSection } from '../types'
import { Block, Cell, FORCE_STATES, Row, Stack } from './Primitives.kit'

const SAMPLE: Record<TagColor, string> = {
  gray: 'Errands',
  brown: 'Reading',
  orange: 'Lab',
  yellow: 'Flashcards',
  green: 'D278',
  blue: 'C182',
  purple: 'C779',
  pink: 'Deep work',
  red: 'Exam prep',
}

function RemovableTags() {
  const [tags, setTags] = useState<TagColor[]>(['blue', 'purple', 'red'])
  return (
    <Row align="center">
      {tags.map((c) => (
        <Tag key={c} color={c} onRemove={() => setTags((t) => t.filter((x) => x !== c))}>
          {SAMPLE[c]}
        </Tag>
      ))}
      {tags.length === 0 && (
        <Button size="sm" variant="ghost" onClick={() => setTags(['blue', 'purple', 'red'])}>
          Restore tags
        </Button>
      )}
    </Row>
  )
}

function FilterChips() {
  const [on, setOn] = useState<TagColor[]>(['blue'])
  const toggle = (c: TagColor) =>
    setOn((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]))
  return (
    <Row align="center">
      {(['blue', 'purple', 'green', 'red'] as const).map((c) => (
        <Tag
          key={c}
          color={c}
          shape="pill"
          icon={<Hash />}
          pressed={on.includes(c)}
          onClick={() => toggle(c)}
        >
          {SAMPLE[c]}
        </Tag>
      ))}
    </Row>
  )
}

function TagDemo() {
  return (
    <Stack>
      <Block caption="Nine colours (text ≥ 5:1 on its tint in both themes)">
        <Row align="center">
          {TAG_COLORS.map((c) => (
            <Tag key={c} color={c}>
              {SAMPLE[c]}
            </Tag>
          ))}
        </Row>
        <Row align="center">
          {TAG_COLORS.map((c) => (
            <Tag key={c} color={c} shape="pill" size="sm">
              {c}
            </Tag>
          ))}
        </Row>
      </Block>

      <Block caption="Removable (the × has its own name: “Remove C182”)">
        <RemovableTags />
      </Block>

      <Block caption="Filter chips: pill + button + aria-pressed; click to toggle">
        <FilterChips />
      </Block>

      <Block caption="Interactive tag states">
        <Row align="start">
          {FORCE_STATES.map((s) => (
            <Cell key={s.label} label={s.label}>
              <Tag color="blue" icon={<Hash />} onClick={() => undefined} data-force={s.force}>
                C182
              </Tag>
            </Cell>
          ))}
          <Cell label="Selected">
            <Tag color="blue" icon={<Hash />} onClick={() => undefined} pressed>
              C182
            </Tag>
          </Cell>
          <Cell label="Disabled">
            <Tag color="blue" icon={<Hash />} onClick={() => undefined} onRemove={() => undefined} disabled>
              C182
            </Tag>
          </Cell>
        </Row>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'tag',
  title: 'Tag',
  group: 'Primitives',
  order: 90,
  description: 'Course codes and labels. Pill shape for filter and quick-add chips.',
  render: () => <TagDemo />,
}

export default section
