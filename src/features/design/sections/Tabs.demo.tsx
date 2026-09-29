import { useState } from 'react'
import { BookOpen, FileText, LayoutList, Link2 } from 'lucide-react'
import { Tabs, type TabItem } from '@/ui/Tabs'
import type { DemoSection } from '../types'
import { Block, Cell, FORCE_STATES, Row, Stack, demo } from './Primitives.kit'

type Section = 'overview' | 'plan' | 'notes' | 'resources' | 'assessments'

const ITEMS: TabItem<Section>[] = [
  { value: 'overview', label: 'Overview', icon: <BookOpen /> },
  { value: 'plan', label: 'Plan', icon: <LayoutList />, count: 24 },
  { value: 'notes', label: 'Notes', icon: <FileText /> },
  { value: 'resources', label: 'Resources', icon: <Link2 />, count: 6 },
  { value: 'assessments', label: 'Assessments', disabled: true },
]

const PANELS: Record<Section, string> = {
  overview: 'C182 Introduction to IT · 4 competency units · 62% complete · on track for Oct 24.',
  plan: '24 scheduled chunks, 25–60 minutes each. Next: “Unit 4 · Operating systems”, today at 2 pm.',
  notes: 'Subnetting finally clicked. Still shaky on IPv6 shorthand.',
  resources: 'Six links: the course guide, two Quizlet decks, the zyBooks chapters and two videos.',
  assessments: '',
}

const SMALL: TabItem<'today' | 'upcoming' | 'done'>[] = [
  { value: 'today', label: 'Today', count: 5 },
  { value: 'upcoming', label: 'Upcoming', count: 12 },
  { value: 'done', label: 'Done' },
]

function TabsDemo() {
  const [tab, setTab] = useState<Section>('plan')
  return (
    <Stack>
      <Block caption="Automatic activation: arrows move and select; Home/End jump; the disabled tab is skipped">
        <div className={demo.card}>
          <Tabs label="Course sections" items={ITEMS} value={tab} onValueChange={setTab}>
            {(v) => <p>{PANELS[v]}</p>}
          </Tabs>
        </div>
      </Block>

      <Block caption="Manual activation (arrows move focus, Enter selects), size sm">
        <Tabs label="Task lists" items={SMALL} activation="manual" size="sm" />
      </Block>

      <Block caption="States (forced on unselected tabs; focus on the selected tab)">
        <Row align="start">
          {FORCE_STATES.map((s) => (
            <Cell key={s.label} label={s.label}>
              <Tabs label={`Task lists, ${s.label}`} items={SMALL} size="sm" data-force={s.force} />
            </Cell>
          ))}
        </Row>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'tabs',
  title: 'Tabs',
  group: 'Primitives',
  order: 80,
  description: 'Switch between sibling views of one thing (a course’s overview, plan, notes).',
  render: () => <TabsDemo />,
}

export default section
