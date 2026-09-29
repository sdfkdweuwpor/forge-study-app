import { useEffect, useState } from 'react'

/** Elements that already do something with Space and Enter (or take typing). */
const INTERACTIVE =
  'a[href], button, input, select, textarea, summary, [contenteditable=""], [contenteditable="true"], ' +
  '[role="radio"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], ' +
  '[role="option"], [role="combobox"], [role="slider"], [role="button"]'

function idleNow(): boolean {
  const el = document.activeElement
  return !el || el === document.body || !el.matches(INTERACTIVE)
}

/**
 * True while nothing that handles Space or Enter itself has keyboard focus (the page body, a heading,
 * `<main>`). The timer's Space and Enter shortcuts only work then, so they never swallow the key of a
 * focused button, link, radio or field: pressing Space on "Stop" must stop, not pause.
 */
export function useKeyboardIdle(): boolean {
  const [idle, setIdle] = useState(idleNow)
  useEffect(() => {
    const update = () => setIdle(idleNow())
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [])
  return idle
}
