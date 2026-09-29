import { useMemo, useState, type ReactNode } from 'react'
import { BookOpen, ListChecks, Moon, Play, Plus, Target } from 'lucide-react'
import { Button } from '@/ui/Button'
import {
  CommandPalette,
  CommandPalettePanel,
  type PaletteGroup,
  type PaletteItem,
} from '@/ui/CommandPalette'
import type { DemoSection } from '../types'
import styles from './Composites.demo.module.css'

interface Entry {
  group: 'actions' | 'tasks' | 'pages'
  item: PaletteItem
}

const ICON = 16

const ENTRIES: Entry[] = [
  {
    group: 'actions',
    item: { id: 'focus', title: 'Start focus session', icon: <Play size={ICON} />, shortcut: 'f' },
  },
  {
    group: 'actions',
    item: { id: 'new-task', title: 'New task', icon: <Plus size={ICON} />, shortcut: 'q' },
  },
  {
    group: 'actions',
    item: {
      id: 'theme',
      title: 'Toggle theme',
      icon: <Moon size={ICON} />,
      shortcut: 'mod+shift+l',
    },
  },
  {
    group: 'actions',
    item: {
      id: 'go-tasks',
      title: 'Go to Tasks',
      subtitle: 'Inbox, upcoming and all tasks',
      icon: <ListChecks size={ICON} />,
      shortcut: 'g t',
    },
  },
  {
    group: 'actions',
    item: {
      id: 'archive',
      title: 'Archive completed tasks',
      subtitle: 'Nothing to archive yet',
      icon: <ListChecks size={ICON} />,
      disabled: true,
    },
  },
  {
    group: 'tasks',
    item: {
      id: 't1',
      title: 'Read chapter 4: Networks and the Internet',
      subtitle: 'C182 Introduction to IT · due tomorrow, 2:00 PM',
      icon: <ListChecks size={ICON} />,
    },
  },
  {
    group: 'tasks',
    item: {
      id: 't2',
      title: 'Practice quiz: variables and loops',
      subtitle: 'D278 Scripting and Programming · due Fri',
      icon: <ListChecks size={ICON} />,
    },
  },
  {
    group: 'tasks',
    item: {
      id: 't3',
      title: 'Outline the HTML5 semantics essay',
      subtitle: 'C779 Web Development Foundations · no date',
      icon: <ListChecks size={ICON} />,
    },
  },
  {
    group: 'pages',
    item: {
      id: 'p1',
      title: 'C182 Introduction to IT',
      subtitle: 'Course · 4 of 9 units done',
      icon: '📘',
    },
  },
  {
    group: 'pages',
    item: {
      id: 'p2',
      title: 'WGU B.S. Computer Science',
      subtitle: 'Goal · 12 of 34 courses',
      icon: <Target size={ICON} />,
    },
  },
  {
    group: 'pages',
    item: {
      id: 'p3',
      title: 'C779 Web Development Foundations',
      subtitle: 'Course · not started',
      icon: <BookOpen size={ICON} />,
    },
  },
]

const HEADINGS: Record<Entry['group'], string> = {
  actions: 'Actions',
  tasks: 'Tasks',
  pages: 'Goals and courses',
}

/** Demo-only subsequence matcher: indices of `query` in `text`, or null. Real search is Phase 3. */
function subsequence(text: string, query: string): number[] | null {
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  const at: number[] = []
  let from = 0
  for (const ch of needle) {
    const i = hay.indexOf(ch, from)
    if (i === -1) return null
    at.push(i)
    from = i + 1
  }
  return at
}

function search(query: string): PaletteGroup[] {
  const q = query.trim()
  const groups = new Map<Entry['group'], PaletteItem[]>()
  for (const { group, item } of ENTRIES) {
    let next: PaletteItem | null = item
    if (q) {
      const inTitle = subsequence(item.title, q.replace(/\s+/g, ''))
      const inSubtitle = item.subtitle ? subsequence(item.subtitle, q.replace(/\s+/g, '')) : null
      next = inTitle
        ? { ...item, matches: inTitle }
        : inSubtitle
          ? { ...item, subtitleMatches: inSubtitle }
          : null
    }
    if (next) groups.set(group, [...(groups.get(group) ?? []), next])
  }
  return (['actions', 'tasks', 'pages'] as const)
    .filter((g) => groups.has(g))
    .map((g) => ({ id: g, heading: HEADINGS[g], items: groups.get(g) ?? [] }))
}

// Precomputed specimen for "c182": fuzzy hits on a title and on subtitles.
const C182_GROUPS: PaletteGroup[] = [
  {
    id: 'tasks',
    heading: 'Tasks',
    items: [
      {
        id: 't1',
        title: 'Read chapter 4: Networks and the Internet',
        subtitle: 'C182 Introduction to IT · due tomorrow, 2:00 PM',
        subtitleMatches: [0, 1, 2, 3],
        icon: <ListChecks size={ICON} />,
      },
      {
        id: 't4',
        title: 'Flashcards: hardware and software',
        subtitle: 'C182 Introduction to IT · due today',
        subtitleMatches: [0, 1, 2, 3],
        icon: <ListChecks size={ICON} />,
      },
    ],
  },
  {
    id: 'pages',
    heading: 'Goals and courses',
    items: [
      {
        id: 'p1',
        title: 'C182 Introduction to IT',
        subtitle: 'Course · 4 of 9 units done',
        matches: [0, 1, 2, 3],
        icon: '📘',
      },
    ],
  },
]

function Specimen({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className={styles.block}>
      <span className={styles.caption}>{caption}</span>
      <div className={styles.stage}>
        <div className={styles.paletteWidth}>{children}</div>
      </div>
    </div>
  )
}

function Demo() {
  const [query, setQuery] = useState('')
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const groups = useMemo(() => search(query), [query])

  const select = (item: PaletteItem) => {
    setPicked(item.title)
    setOverlayOpen(false)
  }

  return (
    <div className={styles.stack}>
      <Specimen caption="Live: type, use ↑ ↓ and Enter, hover with the mouse">
        <CommandPalettePanel
          label="Live command palette"
          query={query}
          onQueryChange={setQuery}
          groups={groups}
          onSelect={select}
        />
      </Specimen>
      <div className={styles.block}>
        <div className={styles.chips}>
          <Button variant="primary" onClick={() => setOverlayOpen(true)}>
            Open as overlay
          </Button>
        </div>
        <span className={styles.value}>
          Last selection: <strong>{picked ?? 'none'}</strong>
        </span>
        <CommandPalette
          open={overlayOpen}
          onOpenChange={setOverlayOpen}
          query={query}
          onQueryChange={setQuery}
          groups={groups}
          onSelect={select}
        />
      </div>

      <Specimen caption="Matched characters, shortcut hints, a disabled row (query “c182”)">
        <CommandPalettePanel
          label="Search results"
          query="c182"
          onQueryChange={() => undefined}
          groups={C182_GROUPS}
          onSelect={() => undefined}
          defaultActiveId="t4"
        />
      </Specimen>

      <Specimen caption="Grouped, empty query">
        <CommandPalettePanel
          label="All commands"
          query=""
          onQueryChange={() => undefined}
          groups={search('')}
          onSelect={() => undefined}
        />
      </Specimen>

      <Specimen caption="Loading">
        <CommandPalettePanel
          label="Loading results"
          query="flash"
          onQueryChange={() => undefined}
          groups={[]}
          loading
          onSelect={() => undefined}
        />
      </Specimen>

      <Specimen caption="Loading more (some results already shown)">
        <CommandPalettePanel
          label="Loading more results"
          query="c182"
          onQueryChange={() => undefined}
          groups={C182_GROUPS.slice(1)}
          loading
          onSelect={() => undefined}
        />
      </Specimen>

      <Specimen caption="No results">
        <CommandPalettePanel
          label="No results"
          query="zzq"
          onQueryChange={() => undefined}
          groups={[]}
          onSelect={() => undefined}
        />
      </Specimen>

      <Specimen caption="Error">
        <CommandPalettePanel
          label="Search error"
          query="c182"
          onQueryChange={() => undefined}
          groups={[]}
          error="Search is unavailable right now."
          onRetry={() => undefined}
          onSelect={() => undefined}
        />
      </Specimen>
    </div>
  )
}

const section: DemoSection = {
  id: 'command-palette',
  title: 'Command palette',
  group: 'Composites',
  order: 20,
  description:
    'Presentational: the app supplies the query, grouped results and what a selection does. Modal on desktop (640px, 20vh from the top), full screen on phones. Arrow keys, Enter and Esc; the combobox keeps focus in the field.',
  render: () => <Demo />,
}

export default section
