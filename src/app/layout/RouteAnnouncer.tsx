import { useEffect, useRef, useState } from 'react'
import { usePathname, useRoute } from '../router'
import { ROUTES } from '../router/routes'
import styles from './RouteAnnouncer.module.css'

/** How long to wait for a lazy page to render its heading before falling back to <main>. */
const HEADING_WAIT_MS = 1500
const APP_SUFFIX = ' · Forge'

/** The page title without the app name ("Goals · Forge" → "Goals"); `fallback` for the bare "Forge" of Today. */
function pageTitle(fallback: string): string {
  const title = document.title.endsWith(APP_SUFFIX)
    ? document.title.slice(0, -APP_SUFFIX.length)
    : document.title
  return title === '' || title === 'Forge' ? fallback : title
}

/**
 * Focus is free to move when nothing meaningful holds it: the page just replaced the element that had it,
 * the click came from navigation chrome, or a closing drawer is going inert. It is not free when focus
 * is already inside the new page (an autofocused field) or inside an open modal.
 */
function focusIsFree(main: HTMLElement): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body || active === main) return true
  if (active.closest('[inert]')) return true
  if (main.contains(active)) return false
  return active.closest('[aria-modal="true"]') === null
}

/**
 * Screen-reader support for client-side navigation, which never reloads the page: after the pathname
 * changes (link, back/forward, shortcut) it moves focus to the new page's <h1> (or <main> if the page
 * has none) and announces the page title in a polite live region. It does nothing on first load.
 */
export function RouteAnnouncer() {
  const pathname = usePathname()
  const routeTitle = ROUTES[useRoute().name].title
  const [message, setMessage] = useState('')
  const previous = useRef(pathname)
  const titleRef = useRef(routeTitle)

  useEffect(() => {
    titleRef.current = routeTitle
  })

  useEffect(() => {
    if (previous.current === pathname) return undefined
    previous.current = pathname

    const main = document.getElementById('main')
    let finished = false
    let raf = 0
    let observer: MutationObserver | undefined
    let giveUp: ReturnType<typeof setTimeout> | undefined
    let announce: ReturnType<typeof setTimeout> | undefined

    const finish = () => {
      if (finished) return
      finished = true
      observer?.disconnect()
      clearTimeout(giveUp)
      if (main && focusIsFree(main)) {
        const heading = main.querySelector('h1')
        if (heading) {
          heading.setAttribute('tabindex', '-1')
          heading.focus({ preventScroll: true })
        } else {
          main.focus({ preventScroll: true })
        }
      }
      // Clear first so navigating between two pages with the same title is announced again.
      setMessage('')
      announce = setTimeout(() => setMessage(pageTitle(titleRef.current)), 60)
    }

    // A frame lets the router, the closing drawer and the page commit before focus moves.
    raf = requestAnimationFrame(() => {
      if (!main || main.querySelector('h1')) {
        finish()
        return
      }
      // A lazy page shows a skeleton first: wait for its heading.
      observer = new MutationObserver(() => {
        if (main.querySelector('h1')) finish()
      })
      observer.observe(main, { childList: true, subtree: true })
      giveUp = setTimeout(finish, HEADING_WAIT_MS)
    })

    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      clearTimeout(giveUp)
      clearTimeout(announce)
    }
  }, [pathname])

  return (
    <div
      className={styles.hidden}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-route-announcer=""
    >
      {message}
    </div>
  )
}
