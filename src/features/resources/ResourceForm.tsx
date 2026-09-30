import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { parseWebUrl, titleFromNote, titleFromUrl, URL_MESSAGES } from '@/logic/resources'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { Textarea } from '@/ui/Textarea'
import type { ResourceView } from './queries'
import styles from './ResourceForm.module.css'

export type FormKind = 'link' | 'note' | 'pdf'

export interface FormValues {
  url: string
  title: string
  notes: string
}

export interface ResourceFormProps {
  mode: 'add' | 'edit'
  kind: FormKind
  /** The resource being edited. */
  initial?: ResourceView
  /** Saves. Resolves to a sentence to show when it did not work, or `null` when it did (the form is closed by the caller). */
  onSubmit: (values: FormValues) => Promise<string | null>
  onCancel: () => void
}

const NAMES: Record<FormKind, string> = { link: 'link', note: 'note', pdf: 'PDF' }

/**
 * The small inline form that adds a link or a note, and edits any resource in place. Enter saves from a
 * single-line field, Ctrl or Cmd + Enter from the note text, Esc cancels. A link is checked as it is typed
 * into the field: only web addresses (http and https) are accepted, and the message is calm and stays
 * under the field it is about.
 */
export function ResourceForm({ mode, kind, initial, onSubmit, onCancel }: ResourceFormProps) {
  const [url, setUrl] = useState(initial?.url ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const first = useRef<HTMLInputElement | null>(null)
  const formId = useId()
  const adding = mode === 'add'

  useEffect(() => {
    // A frame late on purpose: an overlay that has just closed (the command palette) gives focus back to
    // where it started, and would take it from a field that was focused at once.
    const frame = requestAnimationFrame(() => {
      first.current?.focus()
      if (!adding) first.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [adding])

  // A link's title is left blank on purpose: the placeholder shows the one it will get.
  const parsed = kind === 'link' ? parseWebUrl(url) : null
  const derived =
    kind === 'link'
      ? parsed?.ok
        ? titleFromUrl(parsed.url)
        : ''
      : kind === 'note'
        ? notes.trim() === ''
          ? ''
          : titleFromNote(notes)
        : ''

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (saving) return
    setFormError(null)
    if (kind === 'link') {
      const check = parseWebUrl(url)
      if (!check.ok) {
        setUrlError(URL_MESSAGES[check.problem])
        first.current?.focus()
        return
      }
    }
    if (kind === 'note' && title.trim() === '' && notes.trim() === '') {
      setFormError('Give the note a title or write something first.')
      first.current?.focus()
      return
    }
    setSaving(true)
    const message = await onSubmit({ url, title, notes })
    // On success the caller closes (unmounts) this form; only a failure comes back here.
    if (message !== null) {
      setSaving(false)
      setFormError(message)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // Keep Quick add's own Mod+Enter out of a form that is being filled in.
      e.preventDefault()
      void submit()
    }
  }

  const label = adding ? `Add a ${NAMES[kind]}` : `Edit ${NAMES[kind]}`
  const submitLabel = adding ? `Add ${NAMES[kind]}` : 'Save'
  const showUrl = kind === 'link'
  const showBody = kind === 'note'
  const showNote = !adding && kind !== 'note'

  const titleField = (
    <Input
      key="title"
      ref={showUrl ? undefined : first}
      label={kind === 'note' ? 'Title' : adding ? 'Title (optional)' : 'Title'}
      placeholder={derived !== '' ? derived : kind === 'note' ? 'Exam tips' : 'A name for it'}
      value={title}
      maxLength={200}
      autoComplete="off"
      onChange={(e) => {
        setTitle(e.target.value)
        setFormError(null)
      }}
    />
  )

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Esc and Mod+Enter from any field of the form
    <form
      className={styles.form}
      aria-label={label}
      noValidate
      onSubmit={(e) => void submit(e)}
      onKeyDown={onKeyDown}
    >
      {showUrl ? (
        <Input
          ref={first}
          label="Web address"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://developer.mozilla.org/…"
          value={url}
          error={urlError}
          onChange={(e) => {
            setUrl(e.target.value)
            setUrlError(null)
            setFormError(null)
          }}
        />
      ) : null}
      {titleField}
      {showBody ? (
        <Textarea
          label="Note"
          minRows={4}
          maxRows={14}
          maxLength={20000}
          placeholder="What is worth remembering?"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
            setFormError(null)
          }}
        />
      ) : null}
      {showNote ? (
        <Textarea
          label="Note (optional)"
          minRows={2}
          maxRows={8}
          maxLength={20000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      ) : null}
      {formError !== null ? (
        <p className={styles.error} role="alert" id={`${formId}-error`}>
          {formError}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={saving}
          aria-keyshortcuts={showBody ? 'Control+Enter Meta+Enter' : undefined}
        >
          {submitLabel}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
