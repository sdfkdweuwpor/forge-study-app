import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { newId } from '@/lib/ids'
import { getFocusable } from '../Popover/focus'
import { ToastCard } from './ToastCard'
import { ToastContext, type ToastApi, type ToastExtras, type ToastOptions } from './ToastContext'
import {
  MAX_VISIBLE_TOASTS,
  TOAST_EXIT_MS,
  createToastState,
  partitionToasts,
  resolveDuration,
  toastReducer,
  type ToastAction,
  type ToastItem,
  type ToastVariant,
} from './toastReducer'
import styles from './Toast.module.css'

export interface ToastProviderProps {
  children: ReactNode
  /** Toasts on screen at once; more wait in a queue. Default 3. */
  maxVisible?: number
  /**
   * Render the toast stack in place instead of in <body>, positioned inside the nearest positioned
   * ancestor. For /design, so each theme column has its own stack.
   */
  inline?: boolean
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

const isPageHidden = (): boolean => document.visibilityState === 'hidden'

/**
 * Counts a toast's time down while it is visible, and holds it while the pointer or focus is on
 * it (so it never vanishes under someone reading it or reaching for Undo) or the tab is hidden.
 * Time already spent is kept across pauses. `revision` restarts the countdown.
 */
function useAutoDismiss(
  duration: number,
  revision: number,
  paused: boolean,
  onExpire: () => void,
): void {
  const remaining = useRef(duration)
  const expire = useRef(onExpire)
  useEffect(() => {
    expire.current = onExpire
  })
  useEffect(() => {
    remaining.current = duration
  }, [duration, revision])
  useEffect(() => {
    if (duration <= 0 || paused) return undefined
    const startedAt = performance.now()
    const timer = window.setTimeout(() => expire.current(), Math.max(0, remaining.current))
    return () => {
      window.clearTimeout(timer)
      remaining.current -= performance.now() - startedAt
    }
  }, [duration, revision, paused])
}

interface ToastEntryProps {
  item: ToastItem
  dispatch: (action: ToastAction) => void
}

function ToastEntry({ item, dispatch }: ToastEntryProps) {
  const { id } = item
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const pageHidden = useSyncExternalStore(subscribeVisibility, isPageHidden, () => false)

  const dismiss = useCallback(() => dispatch({ type: 'dismiss', id }), [dispatch, id])

  useAutoDismiss(
    item.duration,
    item.revision,
    hovered || focused || pageHidden || item.leaving || item.phase === 'undoing',
    dismiss,
  )

  useEffect(() => {
    if (!item.leaving) return undefined
    const timer = window.setTimeout(() => dispatch({ type: 'remove', id }), TOAST_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [item.leaving, dispatch, id])

  const runUndo = () => {
    const undo = item.undo
    if (!undo) return
    dispatch({ type: 'undoStart', id })
    void (async () => {
      try {
        await undo()
        dispatch({ type: 'undoDone', id })
      } catch {
        dispatch({ type: 'undoFailed', id })
      }
    })()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    dismiss()
  }

  return (
    // The wrapper only forwards pointer and focus to the timer and handles Escape for whatever
    // inside it has focus; the interactive elements are the card's buttons.
    <div
      role="presentation"
      className={styles.entry}
      data-state={item.leaving ? 'closed' : 'open'}
      data-motion="opacity"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
      }}
      onKeyDown={onKeyDown}
    >
      <ToastCard
        variant={item.variant}
        title={item.title}
        description={item.description}
        phase={item.phase}
        onUndo={item.undo ? runUndo : undefined}
        onDismiss={dismiss}
      />
    </div>
  )
}

/**
 * Owns the toast queue and renders the stack. Bottom-right on desktop; bottom-centre above the tab
 * bar on phones. Two persistent live regions carry the announcements: `polite` for everything and
 * `assertive` for errors. Press F8 to move focus into the stack (Undo is then reachable from the
 * keyboard); Esc dismisses the toast that has focus.
 */
export function ToastProvider({
  children,
  maxVisible = MAX_VISIBLE_TOASTS,
  inline = false,
}: ToastProviderProps) {
  const [state, dispatch] = useReducer(toastReducer, maxVisible, createToastState)
  const viewport = useRef<HTMLDivElement>(null)

  const api = useMemo<ToastApi>(() => {
    const show = (options: ToastOptions): string => {
      const id = options.id ?? newId()
      const variant: ToastVariant = options.variant ?? 'default'
      dispatch({
        type: 'add',
        toast: {
          id,
          variant,
          title: options.title,
          description: options.description,
          duration: resolveDuration(variant, options.undo !== undefined, options.duration),
          undo: options.undo,
        },
      })
      return id
    }
    const withVariant =
      (variant: ToastVariant) =>
      (title: string, extras?: ToastExtras): string =>
        show({ ...extras, title, variant })
    return {
      show,
      success: withVariant('success'),
      error: withVariant('error'),
      xp: withVariant('xp'),
      dismiss: (id) => dispatch({ type: 'dismiss', id }),
      dismissAll: () => dispatch({ type: 'dismissAll' }),
    }
  }, [])

  useEffect(() => {
    if (inline) return undefined
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'F8' || e.defaultPrevented) return
      const root = viewport.current
      const target = root ? getFocusable(root)[0] : undefined
      if (!target) return
      e.preventDefault()
      target.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inline])

  const { visible } = partitionToasts(state)
  const errors = visible.filter((item) => item.variant === 'error')
  const others = visible.filter((item) => item.variant !== 'error')

  const stack = (
    <div
      ref={viewport}
      className={styles.viewport}
      data-inline={inline || undefined}
      data-focus-trap-ignore=""
      role="region"
      aria-label="Notifications"
    >
      <div
        className={styles.stack}
        role="alert"
        aria-live="assertive"
        aria-atomic="false"
        aria-relevant="additions text"
      >
        {errors.map((item) => (
          <ToastEntry key={item.id} item={item} dispatch={dispatch} />
        ))}
      </div>
      <div
        className={styles.stack}
        role="status"
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions text"
      >
        {others.map((item) => (
          <ToastEntry key={item.id} item={item} dispatch={dispatch} />
        ))}
      </div>
    </div>
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {inline ? stack : createPortal(stack, document.body)}
    </ToastContext.Provider>
  )
}
