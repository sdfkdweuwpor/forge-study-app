// TEMPORARY host for the Claude plan import's "new goal" entry, until the goals list places
// `ImportGoalButton` itself (Phase 5C hands it to 5B). The relative import is deliberate: this file is
// removed when the button lands on the goals list, and e2e/import.spec.ts is re-pointed there.
import { ImportGoalButton } from '../../goals/import'
import type { DemoSection } from '../types'
import { Block, Stack } from './Primitives.kit'

function PlanImportDemo() {
  return (
    <Stack>
      <Block caption="Goals list: “Import from Claude” creates a new goal from pasted JSON, then opens it">
        <div>
          <ImportGoalButton />
        </div>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'plan-import',
  title: 'Import from Claude',
  group: 'Composites',
  order: 900,
  description:
    'Copy a prompt, paste Claude’s JSON, preview it and import. The same flow is a panel on every goal page.',
  render: () => <PlanImportDemo />,
}

export default section
