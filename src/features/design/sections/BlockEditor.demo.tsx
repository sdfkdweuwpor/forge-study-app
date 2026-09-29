import { useEffect, useState } from 'react'
import { BlockEditor, SlashMenuPanel } from '@/ui/BlockEditor'
import { Button } from '@/ui/Button'
import { Kbd } from '@/ui/Kbd'
import { filterSlash, toPlainText, type Block } from '@/logic/blocks'
import type { DemoSection } from '../types'
import composites from './Composites.demo.module.css'
import styles from './BlockEditor.demo.module.css'

const C182_NOTES: Block[] = [
  { id: 'c182-title', type: 'h1', text: 'C182 Introduction to IT' },
  {
    id: 'c182-intro',
    type: 'p',
    text: 'The objective assessment covers **hardware**, *software*, networking and `binary` conversions. Course guide: [WGU C182](https://www.wgu.edu).',
  },
  {
    id: 'c182-callout',
    type: 'callout',
    text: 'Exam window closes Friday. Book the proctor slot before Wednesday.',
    emoji: '📌',
  },
  { id: 'c182-week', type: 'h2', text: 'This week' },
  { id: 'c182-t1', type: 'todo', text: 'Read chapter 4: Networks and the Internet', checked: true },
  { id: 'c182-t2', type: 'todo', text: 'Flashcards: hardware and software', checked: false },
  { id: 'c182-t3', type: 'todo', text: 'Practice quiz: number systems', checked: false },
  { id: 'c182-rule', type: 'divider', text: '' },
  { id: 'c182-ideas', type: 'h3', text: 'Key ideas' },
  { id: 'c182-b1', type: 'bullet', text: 'The OSI model has 7 layers; TCP/IP has 4' },
  { id: 'c182-b2', type: 'bullet', text: 'Binary `1011` is decimal 11' },
]

const D278_NOTES: Block[] = [
  { id: 'd278-h', type: 'h2', text: 'D278 Scripting and Programming Foundations' },
  { id: 'd278-1', type: 'bullet', text: 'Variables, loops and functions in **pseudocode**' },
  { id: 'd278-2', type: 'todo', text: 'Finish the zyBooks challenge activities', checked: false },
]

const words = (doc: readonly Block[]): number =>
  toPlainText(doc).split(/\s+/).filter(Boolean).length

const KEYS: ReadonlyArray<{ label: string; keys: string }> = [
  { label: 'Block types', keys: '/' },
  { label: 'New block', keys: 'enter' },
  { label: 'New line in a block', keys: 'shift+enter' },
  { label: 'Merge up, or back to text', keys: 'backspace' },
  { label: 'Move between blocks', keys: 'up' },
  { label: 'Move the block', keys: 'alt+up' },
  { label: 'Bold', keys: 'mod+b' },
  { label: 'Italic', keys: 'mod+i' },
  { label: 'Code', keys: 'mod+e' },
  { label: 'Tick a to-do', keys: 'mod+shift+enter' },
  { label: 'Undo', keys: 'mod+z' },
  { label: 'Redo', keys: 'mod+shift+z' },
  { label: 'Leave the editor', keys: 'esc' },
]

/** Live editor with a delayed save, the way a page would use it: `value` stays local, saving is debounced. */
function Live() {
  const [doc, setDoc] = useState<Block[]>(C182_NOTES)
  const [saved, setSaved] = useState<Block[]>(C182_NOTES)

  useEffect(() => {
    const timer = window.setTimeout(() => setSaved(doc), 600)
    return () => window.clearTimeout(timer)
  }, [doc])

  return (
    <div className={composites.block}>
      <span className={composites.caption}>
        Live: type, press / for block types, drag a handle, or try the keys below
      </span>
      <div className={styles.frame}>
        <BlockEditor value={doc} onChange={setDoc} aria-label="C182 notes" />
      </div>
      <span className={composites.value} data-testid="be-status">
        <strong>{doc.length}</strong> blocks · <strong>{words(doc)}</strong> words ·{' '}
        {saved === doc ? 'saved' : 'saving…'}
      </span>
      <div className={composites.chips}>
        <Button size="sm" onClick={() => setDoc(D278_NOTES)}>
          Load D278 notes
        </Button>
        <Button size="sm" onClick={() => setDoc(C182_NOTES)}>
          Reset to C182
        </Button>
      </div>
    </div>
  )
}

function Demo() {
  const [empty, setEmpty] = useState<Block[]>([])
  const everything = filterSlash('')
  const heading = filterSlash('head')

  return (
    <div className={composites.stack}>
      <Live />

      <div className={composites.block}>
        <span className={composites.caption}>Keys</span>
        <ul className={styles.keys}>
          {KEYS.map((k) => (
            <li key={k.label} className={styles.key}>
              <span>{k.label}</span>
              <Kbd keys={k.keys} size="sm" />
            </li>
          ))}
        </ul>
        <span className={composites.note}>
          Markdown at the start of a paragraph or list item converts it: # ## ### heading, - bullet, [] to-do, ›
          callout, --- divider. Tab stays in the editor; Esc leaves it.
        </span>
      </div>

      <div className={composites.block}>
        <span className={composites.caption}>Slash menu: all blocks, and filtered by “head”</span>
        <div className={styles.menuStage}>
          <div className={styles.menuRow}>
            <SlashMenuPanel
              id="demo-slash-all"
              label="All block types"
              items={everything}
              activeIndex={5}
              onChoose={() => undefined}
              inline
            />
            <SlashMenuPanel
              id="demo-slash-head"
              label="Block types matching head"
              items={heading}
              activeIndex={0}
              onChoose={() => undefined}
              inline
            />
          </div>
        </div>
      </div>

      <div className={composites.block}>
        <span className={composites.caption}>Empty: the hint shows without focus</span>
        <div className={styles.frame}>
          <BlockEditor value={empty} onChange={setEmpty} aria-label="New notes" />
        </div>
      </div>

      <div className={composites.block}>
        <span className={composites.caption}>Read-only</span>
        <div className={styles.frame}>
          <BlockEditor value={D278_NOTES} readOnly aria-label="D278 notes (read-only)" />
        </div>
      </div>

      <div className={composites.block}>
        <span className={composites.caption}>Read-only and empty</span>
        <div className={styles.frame}>
          <BlockEditor
            value={[]}
            readOnly
            emptyLabel="No notes for this course yet."
            aria-label="Empty notes (read-only)"
          />
        </div>
      </div>

      <div className={composites.block}>
        <span className={composites.caption}>Loading</span>
        <div className={styles.frame}>
          <BlockEditor value={[]} loading aria-label="Loading notes" />
        </div>
      </div>

      <div className={composites.block}>
        <span className={composites.caption}>Error</span>
        <div className={styles.frame}>
          <BlockEditor
            value={[]}
            error="The notes for C182 could not be read from this device."
            onRetry={() => undefined}
            aria-label="Notes with an error"
          />
        </div>
      </div>
    </div>
  )
}

const section: DemoSection = {
  id: 'block-editor',
  title: 'Block editor',
  group: 'Composites',
  order: 50,
  description:
    'Notes for goals, courses and tasks: paragraphs, headings, bullets, to-dos, callouts and dividers, each a line of plain text. Bold, italic, code and links show as typed while a block is being edited and render when it is not. Type / for the block menu.',
  render: () => <Demo />,
}

export default section
