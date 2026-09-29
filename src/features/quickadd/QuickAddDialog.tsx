import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import { useOverlays } from '@/app/providers/OverlayProvider'
import { recordError } from '@/app/reportError'
import { navigate } from '@/app/router'
import { useShortcutScope } from '@/app/shortcuts'
import { useNow } from '@/app/hooks/useNow'
import { useRestoreFocus } from '@/app/hooks/useRestoreFocus'
import { useSettings } from '@/db/hooks/useSettings'
import { createTask } from '@/db/repos/tasks'
import { dayOf } from '@/logic/dates'
import {
  parseQuickAdd,
  QUICK_ADD_DESTINATION_LABELS,
  quickAddDestination,
  splitByTokens,
} from '@/logic/quickAdd'
import { Button } from '@/ui/Button'
import { Kbd } from '@/ui/Kbd'
import { useToast } from '@/ui/Toast'
import { buildChips, courseFor, describeChips, tokenColor } from './chips'
import { QuickAddChips } from './QuickAddChips'
import { QuickAddField } from './QuickAddField'
import { useCourses } from './queries'
import { toTaskInput } from './taskInput'
import { useKeyboardInset } from './useKeyboardInset'
import styles from './QuickAdd.module.css'

/** The brief's example, so the placeholder shows the syntax at a glance. */
export const QUICK_ADD_PLACEHOLDER = 'Read chapter 4 tomorrow 2p #C182 !high ~2'

/**
 * While open, everything the app root holds is inert (focus and screen readers stay in the dialog)
 * and the page behind cannot scroll.
 */
function useInertBackground(): void {
  useEffect(() => {
    const root = document.getElementById('root')
    const overflow = document.body.style.overflow
    root?.setAttribute('inert', '')
    document.body.style.overflow = 'hidden'
    return () => {
      root?.removeAttribute('inert')
      document.body.style.overflow = overflow
    }
  }, [])
}

/**
 * Quick add: one line of natural language, the parsed pieces as live chips, Enter to create.
 * Top of the screen on desktop, a bottom sheet on phones. Only mounted while open, so every opening
 * starts empty. Enter adds and closes; Shift+Enter adds and stays open for the next task.
 */
export function QuickAddDialog() {
  const overlays = useOverlays()
  const toast = useToast()
  const settings = useSettings()
  const { courses } = useCourses()
  const now = useNow('minute')
  const inset = useKeyboardInset()
  const chipsId = useId()
  const problemId = useId()
  useShortcutScope('modal')
  useInertBackground()
  useRestoreFocus()

  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsTitle, setNeedsTitle] = useState(false)
  const input = useRef<HTMLTextAreaElement | null>(null)
  const pressedOnScrim = useRef(false)

  // Focus at once so the first keystrokes land in the field, and again after everything else has
  // settled (a palette that just closed restores focus in its own effect).
  useEffect(() => {
    input.current?.focus({ preventScroll: true })
    const frame = requestAnimationFrame(() => {
      if (document.activeElement !== input.current) input.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const tagColors = settings?.tagColors
  const parsed = useMemo(
    () =>
      parseQuickAdd(text, {
        now,
        knownCourseCodes: courses.map((c) => c.code),
        knownTags: tagColors ? Object.keys(tagColors) : [],
        ...(settings ? { weekStartsOn: settings.weekStartsOn } : {}),
      }),
    [text, now, courses, tagColors, settings],
  )
  const course = courseFor(parsed, courses)
  const chips = useMemo(() => buildChips(parsed, course, tagColors), [parsed, course, tagColors])
  const segments = useMemo(() => splitByTokens(text, parsed.tokens), [text, parsed.tokens])

  const close = () => overlays.close('quickAdd')
  const canAdd = parsed.title !== '' && !busy

  const change = (value: string) => {
    setText(value)
    setError(null)
    setNeedsTitle(false)
  }

  const submit = async (keepOpen: boolean) => {
    if (busy) return
    if (parsed.title === '') {
      setNeedsTitle(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const added = await createTask(toTaskInput(parsed, course))
      const where = QUICK_ADD_DESTINATION_LABELS[quickAddDestination(parsed, dayOf(Date.now()))]
      toast.show({
        variant: 'success',
        title: `Added to ${where}`,
        description: added.title,
        action: { label: 'Open', onClick: () => navigate('task', { taskId: added.id }) },
      })
      setText('')
      if (!keepOpen) close()
      else input.current?.focus({ preventScroll: true })
    } catch (e) {
      recordError(e, 'quickadd.create')
      setError('Couldn’t add the task. Nothing was saved. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const problem = error ?? (needsTitle ? 'Give the task a title first.' : null)
  const describedBy =
    [chips.length > 0 ? chipsId : null, problem ? problemId : null].filter(Boolean).join(' ') ||
    undefined

  return createPortal(
    <div
      className={styles.scrim}
      role="presentation"
      data-motion="opacity"
      style={{ '--kb-inset': `${inset}px` } as CSSProperties}
      onPointerDown={(e) => {
        pressedOnScrim.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        const onScrim = e.target === e.currentTarget && pressedOnScrim.current
        pressedOnScrim.current = false
        if (onScrim) close()
      }}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Quick add task"
        data-motion="opacity"
      >
        <div className={styles.inputRow}>
          <Plus className={styles.plus} size={18} strokeWidth={1.75} aria-hidden="true" />
          <QuickAddField
            value={text}
            onChange={change}
            segments={segments}
            colorOf={(token) => tokenColor(token, parsed, tagColors)}
            onSubmit={(keepOpen) => void submit(keepOpen)}
            onEscape={close}
            placeholder={QUICK_ADD_PLACEHOLDER}
            describedBy={describedBy}
            invalid={problem !== null}
            inputRef={input}
          />
          <Button
            variant="primary"
            size="sm"
            className={styles.add}
            disabled={!canAdd && !busy}
            loading={busy}
            onClick={() => void submit(false)}
          >
            Add
          </Button>
        </div>

        <QuickAddChips
          id={chipsId}
          chips={chips}
          hint="Add a date, time, #tag, !priority, ~pomodoros or “every weekday” as you type."
        />

        <div className="sr-only" role="status" aria-live="polite">
          {describeChips(chips)}
        </div>

        {problem ? (
          <p id={problemId} className={styles.problem} role="alert">
            {problem}
          </p>
        ) : null}

        <div className={styles.footer} aria-hidden="true">
          <span className={styles.footerHint}>
            <Kbd keys="enter" size="sm" />
            add
          </span>
          <span className={styles.footerHint}>
            <Kbd keys="shift+enter" size="sm" />
            add another
          </span>
          <span className={styles.footerHint}>
            <Kbd keys="esc" size="sm" />
            close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
