import { useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import styles from './PageHeader.module.css'

interface TitleFieldProps {
  title: string
  placeholder: string
  /** Called with the trimmed new title. Not called for an unchanged or empty title. */
  onCommit: (title: string) => void
}

const MAX_LENGTH = 200

/**
 * The editable page title. A one-row textarea that grows with its content, so long course names
 * wrap like a heading instead of scrolling sideways. Enter or blur commits, Esc reverts.
 */
export function TitleField({ title, placeholder, onCommit }: TitleFieldProps) {
  const field = useRef<HTMLTextAreaElement>(null)
  const settled = useRef(false)
  const [draft, setDraft] = useState(title)
  const [seenTitle, setSeenTitle] = useState(title)
  if (title !== seenTitle) {
    setSeenTitle(title)
    setDraft(title)
  }

  const fit = () => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useLayoutEffect(fit, [draft])

  // Wrapping changes when the column resizes, so re-fit on width changes only.
  useLayoutEffect(() => {
    const el = field.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      fit()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const commit = () => {
    const next = draft.replace(/\s+/g, ' ').trim()
    if (next === '') {
      setDraft(title)
      return
    }
    setDraft(next)
    if (next !== title) onCommit(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      settled.current = true
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setDraft(title)
      settled.current = true
      e.currentTarget.blur()
    }
  }

  return (
    <h1 className={styles.titleHeading}>
      <textarea
        ref={field}
        rows={1}
        className={styles.titleInput}
        value={draft}
        placeholder={placeholder}
        aria-label="Page title"
        maxLength={MAX_LENGTH}
        spellCheck={false}
        enterKeyHint="done"
        onFocus={() => {
          settled.current = false
        }}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
          setDraft(e.target.value.replace(/[\r\n]+/g, ' '))
        }
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (settled.current) {
            settled.current = false
            return
          }
          commit()
        }}
      />
    </h1>
  )
}
