import { useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '../Button'
import { PAGE_EMOJI } from './emoji'
import styles from './PageHeader.module.css'

interface EmojiGridProps {
  current: string | null
  onPick: (emoji: string) => void
  /** Present when an icon is set. */
  onRemove?: () => void
}

/**
 * The icon picker body: a grid of buttons with one tab stop (roving tabindex) and arrow-key
 * movement. Rendered inside a Popover, which focuses the `[data-autofocus]` cell on open.
 */
export function EmojiGrid({ current, onPick, onRemove }: EmojiGridProps) {
  const grid = useRef<HTMLDivElement>(null)
  const start = Math.max(
    0,
    PAGE_EMOJI.findIndex((e) => e.char === current),
  )
  const [focusIndex, setFocusIndex] = useState(start)

  const move = (to: number) => {
    const next = Math.min(PAGE_EMOJI.length - 1, Math.max(0, to))
    setFocusIndex(next)
    grid.current?.querySelectorAll<HTMLElement>('[data-cell]')[next]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const columns = grid.current
      ? Math.max(1, getComputedStyle(grid.current).gridTemplateColumns.split(' ').length)
      : 1
    const deltas: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    }
    const delta = deltas[e.key]
    if (delta !== undefined) {
      e.preventDefault()
      move(focusIndex + delta)
    } else if (e.key === 'Home') {
      e.preventDefault()
      move(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      move(PAGE_EMOJI.length - 1)
    }
  }

  return (
    <div className={styles.emojiPicker}>
      {/* Arrow keys are handled on the group; the cells are the interactive elements. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- roving-tabindex group */}
      <div
        ref={grid}
        role="group"
        aria-label="Icons"
        className={styles.emojiGrid}
        onKeyDown={onKeyDown}
      >
        {PAGE_EMOJI.map((emoji, i) => (
          <button
            key={emoji.char}
            type="button"
            data-cell=""
            data-autofocus={i === focusIndex ? '' : undefined}
            tabIndex={i === focusIndex ? 0 : -1}
            className={styles.emojiCell}
            aria-label={emoji.name}
            aria-pressed={emoji.char === current}
            onClick={() => onPick(emoji.char)}
          >
            <span aria-hidden="true">{emoji.char}</span>
          </button>
        ))}
      </div>
      {onRemove ? (
        <Button variant="ghost" size="sm" className={styles.removeButton} onClick={onRemove}>
          Remove icon
        </Button>
      ) : null}
    </div>
  )
}
