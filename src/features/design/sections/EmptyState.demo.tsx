import { Inbox, Plus, SearchX, Target } from 'lucide-react'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Kbd } from '@/ui/Kbd'
import type { DemoSection } from '../types'
import { Block, Stack, demo } from './Primitives.kit'

function EmptyStateDemo() {
  return (
    <Stack>
      <Block caption="Page (md, centred)">
        <div className={demo.card}>
          <EmptyState
            icon={<Inbox />}
            title="Inbox zero"
            description={
              <>
                Tasks you capture with <Kbd keys="q" size="sm" /> land here until you schedule them.
              </>
            }
            action={
              <Button variant="primary" iconLeft={<Plus />}>
                New task
              </Button>
            }
          />
        </div>
      </Block>

      <Block caption="Panel (sm, start-aligned) and a no-results state">
        <div className={demo.split}>
          <div className={demo.card}>
            <EmptyState
              size="sm"
              align="start"
              icon={<Target />}
              title="No goals yet"
              description="Break a big goal into courses, then into daily tasks."
              action={<Button size="sm">Create a goal</Button>}
            />
          </div>
          <div className={demo.card}>
            <EmptyState
              size="sm"
              icon={<SearchX />}
              title="No tasks match “C959”"
              description="Try another tag, or clear the filter."
              action={
                <Button size="sm" variant="ghost">
                  Clear filter
                </Button>
              }
            />
          </div>
        </div>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'empty-state',
  title: 'EmptyState',
  group: 'Primitives',
  order: 150,
  description: 'Icon, title, one line and an action: every list has one.',
  render: () => <EmptyStateDemo />,
}

export default section
