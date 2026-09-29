import { useId, useState, type KeyboardEvent, type Ref } from 'react'
import { recordError } from '@/app/reportError'
import { updateTask } from '@/db/repos/tasks'
import type { Task } from '@/db/types'
import { cleanTags, normalizeTag, tagColor } from '@/logic/tagColor'
import { Tag } from '@/ui/Tag'
import { useTaskEnv } from './TaskActions'
import { useTagList } from './queries'
import styles from './TagsField.module.css'

interface TagsFieldProps {
  task: Pick<Task, 'id' | 'tags'>
  /** So the `#` shortcut can put the caret here. */
  inputRef?: Ref<HTMLInputElement>
}

/** Tags as coloured chips with an "add tag" input that suggests the tags you already use. */
export function TagsField({ task, inputRef }: TagsFieldProps) {
  const { tagColors } = useTaskEnv()
  const known = useTagList()
  const listId = useId()
  const [draft, setDraft] = useState('')

  function save(tags: string[]) {
    updateTask(task.id, { tags }).catch((error: unknown) => recordError(error, 'saveTags'))
  }

  function add(raw: string) {
    const next = cleanTags([...task.tags, ...raw.split(',')])
    setDraft('')
    if (next.length !== task.tags.length) save(next)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (draft.trim() !== '') add(draft)
    } else if (e.key === 'Backspace' && draft === '' && task.tags.length > 0) {
      save(task.tags.slice(0, -1))
    } else if (e.key === 'Escape' && draft !== '') {
      e.stopPropagation()
      setDraft('')
    }
  }

  const suggestions = (known ?? []).filter(
    (t) => !task.tags.some((own) => normalizeTag(own) === normalizeTag(t)),
  )

  return (
    <div className={styles.field}>
      {task.tags.map((tag) => (
        <Tag
          key={tag}
          color={tagColor(tag, tagColors)}
          onRemove={() => save(task.tags.filter((t) => t !== tag))}
          removeLabel={`Remove tag ${tag}`}
        >
          {tag}
        </Tag>
      ))}
      <input
        ref={inputRef}
        className={styles.input}
        value={draft}
        list={listId}
        placeholder={task.tags.length === 0 ? 'Add a tag' : 'Add'}
        aria-label="Add a tag"
        size={Math.max(6, draft.length + 1)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim() !== '') add(draft)
        }}
      />
      <datalist id={listId}>
        {suggestions.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  )
}
