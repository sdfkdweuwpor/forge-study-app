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
import { runUndo } from './runUndo'
import { ToastCard } from './ToastCard'
import {
  ToastContext,
  ToastUndoContext,
  type ToastApi,
  type ToastExtras,
  type ToastOptions,
  type ToastUndoApi,
} from './ToastContext'
import {
  MAX_VISIBLE_TOASTS,
  TOAST_EXIT_MS,
  canStartUndo,
  createToastState,
  latestUndoable,
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
  /** Starts the toast's Undo: the provider's single path, shared with `mod+z`. */
  startUndo: (id: string) => void
}

function ToastEntry({ item, dispatch, startUndo }: ToastEntryProps) {
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
        undoRefusal={item.undoRefusal}
        onUndo={item.undo ? () => startUndo(id) : undefined}
        action={
          item.action
            ? {
                label: item.action.label,
                onClick: () => {
                  item.action?.onClick()
                  dismiss()
                },
              }
            : undefined
        }
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
  /** What had focus when F8 took it into the stack: it gets it back when the toast it was on goes away. */
  const returnTo = useRef<HTMLElement | null>(null)

  // The newest state, for callers that are not rendering (a key press), and the Undos that have been
  // started but are not yet in it.
  const latest = useRef(state)
  const running = useRef(new Set<string>())
  useEffect(() => {
    latest.current = state
  })

  /**
   * The one way an Undo starts, for the toast's button and for `mod+z`. Ignores a toast that offers none
   * (gone, finished, refused) and one already running, so a double press cannot undo twice.
   */
  const startUndo = useCallback((id: string): boolean => {
    const item = latest.current.items.find((candidate) => candidate.id === id)
    if (!item || !canStartUndo(item) || running.current.has(id)) return false
    running.current.add(id)
    void runUndo(item, dispatch).finally(() => running.current.delete(id))
    return true
  }, [])

  const undoApi = useMemo<ToastUndoApi>(() => {
    const target = (): ToastItem | undefined => {
      const item = latestUndoable(latest.current)
      return item && !running.current.has(item.id) ? item : undefined
    }
    return {
      canUndo: () => target() !== undefined,
      undoLatest: () => {
        const item = target()
        return item !== undefined && startUndo(item.id)
      },
    }
  }, [startUndo])

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
          action: options.action,
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
      const from = document.activeElement
      // Pressing F8 again from inside the stack keeps the place it first came from.
      if (from instanceof HTMLElement && !root?.contains(from)) returnTo.current = from
      target.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inline])

  // Leaving the stack on purpose (a click or tap anywhere else, or focus moving to another element)
  // forgets where F8 came from, so a toast that later goes away never pulls focus back to it. When a
  // toast with focus is simply removed no event fires, and that is the case the effect below handles.
  useEffect(() => {
    if (inline) return undefined
    const forgetOrigin = (e: Event) => {
      if (e.target instanceof Node && viewport.current?.contains(e.target)) return
      returnTo.current = null
    }
    document.addEventListener('pointerdown', forgetOrigin, true)
    document.addEventListener('focusin', forgetOrigin, true)
    return () => {
      document.removeEventListener('pointerdown', forgetOrigin, true)
      document.removeEventListener('focusin', forgetOrigin, true)
    }
  }, [inline])

  // A toast that has focus goes away (Undo done, Esc, time up): focus must not fall to the page body,
  // so it goes back to where F8 came from. If focus went somewhere else on purpose, that stands.
  useEffect(() => {
    const back = returnTo.current
    if (!back) return
    const active = document.activeElement
    if (active && active !== document.body && viewport.current?.contains(active)) return
    returnTo.current = null
    if ((!active || active === document.body) && back.isConnected)
      back.focus({ preventScroll: true })
  }, [state])

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
          <ToastEntry key={item.id} item={item} dispatch={dispatch} startUndo={startUndo} />
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
          <ToastEntry key={item.id} item={item} dispatch={dispatch} startUndo={startUndo} />
        ))}
      </div>
    </div>
  )

  return (
    <ToastContext.Provider value={api}>
      <ToastUndoContext.Provider value={undoApi}>
        {children}
        {inline ? stack : createPortal(stack, document.body)}
      </ToastUndoContext.Provider>
    </ToastContext.Provider>
  )
}
