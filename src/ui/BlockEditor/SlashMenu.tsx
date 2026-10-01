import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import { Heading1, Heading2, Heading3, Lightbulb, List, ListTodo, Minus, Type } from 'lucide-react'
import type { SlashCommand, SlashCommandId } from '@/logic/blocks'
import { OverlayPortal } from '../Popover/OverlayPortal'
import { PopoverPanel } from '../Popover/PopoverPanel'
import { computePosition } from '../Popover/position'
import { cx } from '../internal/cx'
import styles from './SlashMenu.module.css'

const ICONS: Record<SlashCommandId, ReactNode> = {
  text: <Type />,
  h1: <Heading1 />,
  h2: <Heading2 />,
  h3: <Heading3 />,
  bullet: <List />,
  todo: <ListTodo />,
  callout: <Lightbulb />,
  divider: <Minus />,
}

/** What typing at the start of a block does instead of opening the menu. */
const MARKDOWN_HINTS: Record<SlashCommandId, string> = {
  text: '',
  h1: '#',
  h2: '##',
  h3: '###',
  bullet: '-',
  todo: '[]',
  callout: '>',
  divider: '---',
}

/** DOM id of an option, for `aria-activedescendant` on the field that owns the menu. */
export function slashOptionId(listboxId: string, command: SlashCommandId): string {
  return `${listboxId}-${command}`
}

export interface SlashMenuPanelProps {
  items: readonly SlashCommand[]
  /** Index of the highlighted option. */
  activeIndex: number
  /** Id of the listbox; the owner points `aria-controls` at it. */
  id: string
  label?: string
  onChoose: (command: SlashCommandId) => void
  /** The pointer moved over an option. */
  onHover?: (index: number) => void
  /** Render in normal flow, without animation (for /design specimens). */
  inline?: boolean
  className?: string
  ref?: Ref<HTMLDivElement>
}

/**
 * The slash menu itself: a listbox of block types with the filtered list, one highlighted. It
 * never takes focus (the caret stays in the block); the owner drives `activeIndex` and points
 * `aria-activedescendant` at `slashOptionId(id, command)`.
 */
export function SlashMenuPanel({
  items,
  activeIndex,
  id,
  label = 'Insert a block',
  onChoose,
  onHover,
  inline,
  className,
  ref,
}: SlashMenuPanelProps) {
  const list = useRef<HTMLDivElement | null>(null)

  // Keep the highlighted option visible when arrow keys walk past the scroll edge. Scrolls the
  // panel only: scrollIntoView would also scroll the page (a specimen on /design would yank it).
  useLayoutEffect(() => {
    const panel = list.current?.parentElement
    const active = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!panel || !active || panel.scrollHeight <= panel.clientHeight) return
    const top =
      active.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop
    const bottom = top + active.offsetHeight
    if (top < panel.scrollTop) panel.scrollTop = top
    else if (bottom > panel.scrollTop + panel.clientHeight)
      panel.scrollTop = bottom - panel.clientHeight
  }, [activeIndex, items])

  return (
    <PopoverPanel
      ref={ref}
      inline={inline}
      data-state="open"
      className={cx(styles.menu, className)}
      // Pressing the menu must not move focus out of the block being edited.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div ref={list} id={id} role="listbox" aria-label={label} className={styles.list}>
        {items.map((command, index) => (
          <button
            key={command.id}
            type="button"
            role="option"
            id={slashOptionId(id, command.id)}
            aria-selected={index === activeIndex}
            tabIndex={-1}
            className={styles.option}
            onClick={() => onChoose(command.id)}
            onMouseMove={() => {
              if (index !== activeIndex) onHover?.(index)
            }}
          >
            <span className={styles.icon} aria-hidden="true">
              {ICONS[command.id]}
            </span>
            <span className={styles.text}>
              <span className={styles.label}>{command.label}</span>
              <span className={styles.description}>{command.description}</span>
            </span>
            {MARKDOWN_HINTS[command.id] !== '' && (
              <span className={styles.hint} aria-hidden="true">
                {MARKDOWN_HINTS[command.id]}
              </span>
            )}
          </button>
        ))}
      </div>
    </PopoverPanel>
  )
}

export interface SlashMenuProps extends Omit<SlashMenuPanelProps, 'inline' | 'className' | 'ref'> {
  /** The caret's rectangle in viewport coordinates; the menu opens under it. */
  getAnchor: () => DOMRect | null
  /** An element inside the themed sub-tree (the /design columns) so the portal is themed too. */
  origin: Element | null
}

/**
 * The slash menu, portaled to <body> and placed under the caret (above it when there is no
 * room). It follows the caret as the text reflows, and the page as it scrolls or resizes.
 */
export function SlashMenu({ getAnchor, origin, ...panel }: SlashMenuProps) {
  const box = useRef<HTMLDivElement | null>(null)

  // Placed by hand on the element, like the tooltip: the menu re-measures on every render and
  // scroll, and a state update for each would just re-render the editor for nothing.
  const measure = useCallback(() => {
    const el = box.current
    const rect = el ? getAnchor() : null
    if (!el || !rect) return
    const next = computePosition({
      anchor: { x: rect.left, y: rect.top, width: Math.max(1, rect.width), height: rect.height },
      floating: { width: el.offsetWidth, height: Math.max(el.offsetHeight, el.scrollHeight) },
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      side: 'bottom',
      align: 'start',
      offset: 4,
    })
    el.style.left = `${next.x}px`
    el.style.top = `${next.y}px`
    el.style.maxHeight = `${next.maxHeight}px`
    el.dataset.side = next.side
    el.dataset.placed = ''
  }, [getAnchor])

  // After every render: the list may have shrunk, or the caret moved with the typed text.
  useLayoutEffect(() => {
    measure()
  })

  useEffect(() => {
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    // The caret only reaches its new block after this menu first renders (Enter, the + button).
    schedule()
    document.addEventListener('selectionchange', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, { capture: true })
    }
  }, [measure])

  return (
    <OverlayPortal origin={origin}>
      <SlashMenuPanel {...panel} ref={box} className={styles.floating} />
      <span className="sr-only" role="status">
        {panel.items.length === 1 ? '1 block type' : `${panel.items.length} block types`}
      </span>
    </OverlayPortal>
  )
}
