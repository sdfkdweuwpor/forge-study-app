/**
 * Body scroll lock, shared by every open modal (reference counted so a modal opened from a modal
 * does not unlock the page when the inner one closes). The scrollbar's width is added as padding so
 * the page does not shift sideways when it disappears.
 */

let locks = 0
let saved: { overflow: string; paddingRight: string } | null = null

export function lockBodyScroll(): () => void {
  const body = document.body
  if (locks === 0) {
    saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight }
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    if (scrollbar > 0) {
      const current = parseFloat(getComputedStyle(body).paddingRight) || 0
      body.style.paddingRight = `${current + scrollbar}px`
    }
    body.style.overflow = 'hidden'
  }
  locks += 1

  let released = false
  return () => {
    if (released) return
    released = true
    locks -= 1
    if (locks === 0 && saved) {
      body.style.overflow = saved.overflow
      body.style.paddingRight = saved.paddingRight
      saved = null
    }
  }
}
