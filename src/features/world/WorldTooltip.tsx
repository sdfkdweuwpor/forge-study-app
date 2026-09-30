import { useLayoutEffect, useRef } from 'react'
import { tooltipText, type Placed } from '@/logic/world'
import styles from './WorldPage.module.css'

export interface TipState {
  item: Placed
  /** Canvas-relative CSS pixels: the pointer, or the item's middle for keyboard focus. */
  x: number
  y: number
  via: 'pointer' | 'keyboard'
}

const GAP = 16

/**
 * What an item was earned from and when. Follows the pointer, flipping to the other side of it near the
 * right and bottom edges of the stage (its parent) so it never leaves the canvas. It ignores the pointer.
 */
export function WorldTooltip({ tip }: { tip: TipState }) {
  const ref = useRef<HTMLDivElement>(null)
  const text = tooltipText(tip.item)

  useLayoutEffect(() => {
    const el = ref.current
    const stage = el?.parentElement
    if (!el || !stage) return
    const { offsetWidth: w, offsetHeight: h } = el
    const left = tip.x + GAP + w > stage.clientWidth ? Math.max(0, tip.x - GAP - w) : tip.x + GAP
    const top = tip.y + GAP + h > stage.clientHeight ? Math.max(0, tip.y - GAP - h) : tip.y + GAP
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  })

  return (
    <div ref={ref} className={styles.tip} role="tooltip" data-testid="world-tooltip">
      <p className={styles.tipTitle}>{text.title}</p>
      {text.detail !== '' && <p className={styles.tipDetail}>{text.detail}</p>}
      {text.date !== '' && <p className={styles.tipDate}>{text.date}</p>}
    </div>
  )
}
