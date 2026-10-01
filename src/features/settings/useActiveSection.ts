import { useEffect, useState, type RefObject } from 'react'
import { activeSectionId } from '@/logic/sectionOrder'
import type { NavLock } from './sectionScroll'
import { sectionDomId } from './sections'

/** A section counts as the one being read once its top is this far from the top of the viewport. */
const OFFSET_PX = 140

/**
 * The section being read as the page scrolls (a scroll-spy for the section nav). At the very bottom the
 * last section wins even when it is too short to reach the top of the screen.
 */
export function useActiveSection(
  slugs: readonly string[],
  lock: RefObject<NavLock | null>,
): string | undefined {
  const [active, setActive] = useState<string | undefined>(slugs[0])
  const key = slugs.join('|')
  useEffect(() => {
    const list = key.split('|')
    let frame = 0
    const update = () => {
      frame = 0
      const held = lock.current
      if (held && performance.now() < held.until) {
        setActive(held.slug)
        return
      }
      const root = document.documentElement
      const atBottom = window.innerHeight + window.scrollY >= root.scrollHeight - 4
      if (atBottom && window.scrollY > 0) {
        setActive(list.at(-1))
        return
      }
      const tops = list.flatMap((id) => {
        const el = document.getElementById(sectionDomId(id))
        return el ? [{ id, top: el.getBoundingClientRect().top }] : []
      })
      setActive(activeSectionId(tops, OFFSET_PX))
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    schedule()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [key, lock])
  return active
}
