import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/** Registers one hold; returns its release. */
type Hold = () => () => void

const SettleContext = createContext<Hold | null>(null)

/** However long a hold lasts, the region shows after this: a slow query costs a shift, never a blank page. */
const MAX_WAIT_MS = 1000

/**
 * A region that appears in one piece. Parts of a page read their data separately, and a card that pops
 * in above what is already on screen pushes it down under the reader's finger (a tap lands on the wrong
 * row) and costs layout shift. Inside `Settle`, a part that is still loading calls `useSettleHold(true)`:
 * the region stays hidden (`visibility: hidden`, so it takes its space, is skipped by focus and screen
 * readers, and moves nothing anyone can see) until every hold lets go, then shows once and stays shown.
 *
 * Holds are taken in a layout effect, so nothing is painted before them. Outside a `Settle` the hook
 * does nothing. Keep the page heading outside the region: it paints first and takes the route focus.
 * A hidden control refuses focus, so code that moves focus into the region uses `focusWhenShown`.
 */
export function Settle({
  children,
  className,
  loading = false,
}: {
  children: ReactNode
  className?: string
  /** The page's own hold (its main data), beside the ones its parts take. */
  loading?: boolean
}) {
  const [pending, setPending] = useState(0)
  const [settled, setSettled] = useState(false)
  const count = useRef(0)

  const hold = useCallback<Hold>(() => {
    count.current += 1
    setPending(count.current)
    let released = false
    return () => {
      if (released) return
      released = true
      count.current -= 1
      setPending(count.current)
    }
  }, [])

  // Children's layout effects run before this one, so on the first commit their holds are already in
  // `count` (the `pending` state only catches up on the next render).
  useLayoutEffect(() => {
    if (!settled && !loading && count.current === 0) setSettled(true)
  }, [loading, pending, settled])

  useEffect(() => {
    if (settled) return
    const timer = window.setTimeout(() => setSettled(true), MAX_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [settled])

  const value = useMemo(() => (settled ? null : hold), [settled, hold])
  return (
    <SettleContext.Provider value={value}>
      <div
        className={className}
        style={settled ? undefined : { visibility: 'hidden' }}
        aria-busy={settled ? undefined : true}
        data-settling={settled ? undefined : ''}
      >
        {children}
      </div>
    </SettleContext.Provider>
  )
}

/** Keeps the surrounding `Settle` hidden while `loading` is true (only until it has shown once). */
export function useSettleHold(loading: boolean): void {
  const hold = useContext(SettleContext)
  useLayoutEffect(() => {
    if (!loading || !hold) return
    return hold()
  }, [loading, hold])
}

/**
 * Focuses `el` (then runs `after`, e.g. a scroll), at once or, while a `Settle` around it is still hidden
 * (a hidden control refuses focus), as soon as that region shows. Returns a cancel for a pending focus.
 */
export function focusWhenShown(el: HTMLElement, after?: () => void): () => void {
  const region = el.closest('[data-settling]')
  const run = () => {
    el.focus({ preventScroll: true })
    after?.()
  }
  if (!region) {
    run()
    return () => undefined
  }
  const observer = new MutationObserver(() => {
    if (region.hasAttribute('data-settling')) return
    observer.disconnect()
    run()
  })
  observer.observe(region, { attributes: true, attributeFilter: ['data-settling'] })
  return () => observer.disconnect()
}
