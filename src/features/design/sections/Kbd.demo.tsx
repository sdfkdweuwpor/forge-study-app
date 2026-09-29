import { Kbd } from '@/ui/Kbd'
import type { DemoSection } from '../types'
import { Block, Stack } from './Primitives.kit'
import styles from './Kbd.demo.module.css'

const SHORTCUTS: Array<[string, string]> = [
  ['mod+k', 'Command palette'],
  ['q', 'Quick add'],
  ['mod+\\', 'Toggle sidebar'],
  ['g t', 'Go to Today'],
  ['shift+s', 'Start focus on the “Now” task'],
  ['mod+shift+z', 'Redo'],
  ['alt+up', 'Move task up'],
  ['mod+enter', 'Submit'],
  ['mod+backspace', 'Move to Trash'],
  ['esc', 'Close'],
  ['?', 'Shortcut sheet'],
]

function KbdDemo() {
  return (
    <Stack>
      <Block caption="Keycaps per platform (this device picks automatically)">
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">macOS</th>
              <th scope="col">Windows / Linux</th>
              <th scope="col">Plain (menus)</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map(([keys, action]) => (
              <tr key={keys}>
                <td>{action}</td>
                <td>
                  <Kbd keys={keys} platform="mac" />
                </td>
                <td>
                  <Kbd keys={keys} platform="other" />
                </td>
                <td>
                  <Kbd keys={keys} variant="plain" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>

      <Block caption="Inline in text, size sm">
        <p className={styles.prose}>
          Press <Kbd keys="q" size="sm" /> anywhere to add a task, or <Kbd keys="mod+k" size="sm" /> to
          search. Sequences read as <Kbd keys="g f" size="sm" />.
        </p>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'kbd',
  title: 'Kbd',
  group: 'Primitives',
  order: 100,
  description: "Shortcut hints from 'mod+k'-style specs: ⌘ on macOS, Ctrl elsewhere; spoken as words.",
  render: () => <KbdDemo />,
}

export default section
