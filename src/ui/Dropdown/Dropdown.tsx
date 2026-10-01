import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type MouseEventHandler,
  type KeyboardEventHandler,
  type ReactNode,
  type RefCallback,
} from 'react'
import { useControllable } from '../internal/useControllable'
import { FloatingLayer } from '../Popover/FloatingLayer'
import type { Align, Side } from '../Popover/position'
import { firstIndex, lastIndex, stepIndex, typeaheadIndex } from './menuNav'
import { MenuItems, type MenuEntry, type MenuItem } from './MenuItems'
import styles from './Dropdown.module.css'

/** Spread these onto the trigger element. Its ref must reach a DOM element. */
export interface DropdownTriggerProps {
  ref: RefCallback<HTMLElement>
  id: string
  onClick: MouseEventHandler<HTMLElement>
  onKeyDown: KeyboardEventHandler<HTMLElement>
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-controls': string | undefined
}

export interface DropdownProps {
  /** Renders the trigger, e.g. `(p) => <IconButton {...p} label="More" icon={<MoreHorizontal />} />`. */
  trigger: (props: DropdownTriggerProps) => ReactNode
  items: readonly MenuEntry[]
  /** Accessible name of the menu. Defaults to the trigger's name. */
  label?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  side?: Side
  align?: Align
  offset?: number
  matchTriggerWidth?: boolean
  /** Shown when `items` has no actionable entries. */
  emptyLabel?: string
}

type InitialFocus = 'first' | 'last' | 'menu'

/** How long a typeahead buffer lives after the last key. */
const TYPEAHEAD_RESET_MS = 700

const menuItemsOf = (menu: HTMLElement): HTMLElement[] =>
  Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))

const isEnabled = (el: HTMLElement): boolean => el.getAttribute('aria-disabled') !== 'true'

/**
 * A menu button. Trigger: Enter, Space or a click opens it (keyboard focuses the first item),
 * ArrowDown / ArrowUp open it on the first / last item. Menu: ArrowUp/Down (wrapping), Home/End,
 * typeahead by label, Enter/Space to choose, Esc to close and return focus to the trigger, Tab to
 * close and move on. Hovering an item focuses it. Choosing an item runs `onSelect`, then closes.
 */
export function Dropdown({
  trigger,
  items,
  label,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  offset,
  matchTriggerWidth,
  emptyLabel,
}: DropdownProps) {
  const [open, setOpen] = useControllable(openProp, defaultOpen, onOpenChange)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [menu, setMenu] = useState<HTMLDivElement | null>(null)
  const triggerId = useId()
  const menuId = useId()
  const [initialFocus, setInitialFocus] = useState<InitialFocus>('menu')
  const menuEl = useRef<HTMLDivElement | null>(null)
  const typed = useRef({ buffer: '', timer: 0 })

  // Focus into the menu on open; back to the trigger on close (unless the user clicked elsewhere).
  useEffect(() => {
    if (!open || !menu) return undefined
    const frame = requestAnimationFrame(() => {
      const els = menuItemsOf(menu)
      const enabled = els.map(isEnabled)
      const target =
        initialFocus === 'first'
          ? els[firstIndex(enabled)]
          : initialFocus === 'last'
            ? els[lastIndex(enabled)]
            : undefined
      ;(target ?? menu).focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, menu, initialFocus])

  useEffect(() => {
    if (!open) return undefined
    const state = typed.current
    return () => {
      window.clearTimeout(state.timer)
      state.buffer = ''
      // Back to the trigger unless the user has moved focus elsewhere on purpose.
      const active = document.activeElement
      const stillInside =
        active === null || active === document.body || menuEl.current?.contains(active)
      if (stillInside) anchor?.focus({ preventScroll: true })
    }
  }, [open, anchor])

  const openWith = useCallback(
    (focus: InitialFocus) => {
      setInitialFocus(focus)
      setOpen(true)
    },
    [setOpen],
  )

  const close = useCallback(() => setOpen(false), [setOpen])

  const setMenuRefs = useCallback((node: HTMLDivElement | null) => {
    menuEl.current = node
    setMenu(node)
  }, [])

  const onChoose = useCallback(
    (item: MenuItem) => {
      setOpen(false)
      item.onSelect()
    },
    [setOpen],
  )

  const onTriggerClick = (e: MouseEvent<HTMLElement>) => {
    if (open) {
      setOpen(false)
      return
    }
    // `detail` is 0 for a click synthesised by Enter or Space.
    openWith(e.detail === 0 ? 'first' : 'menu')
  }

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    if (open && menu) {
      const els = menuItemsOf(menu)
      const enabled = els.map(isEnabled)
      els[e.key === 'ArrowDown' ? firstIndex(enabled) : lastIndex(enabled)]?.focus({
        preventScroll: true,
      })
    } else {
      openWith(e.key === 'ArrowDown' ? 'first' : 'last')
    }
  }

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const els = menuItemsOf(e.currentTarget)
    const enabled = els.map(isEnabled)
    const current = els.findIndex((el) => el === document.activeElement)
    const focusAt = (i: number) => els[i]?.focus({ preventScroll: true })

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focusAt(stepIndex(enabled, current, 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        focusAt(stepIndex(enabled, current, -1))
        return
      case 'Home':
        e.preventDefault()
        focusAt(firstIndex(enabled))
        return
      case 'End':
        e.preventDefault()
        focusAt(lastIndex(enabled))
        return
      default:
    }

    // Typeahead: printable characters only. Space continues a buffer ("new t") but otherwise
    // activates the focused item like a button.
    const state = typed.current
    const isChar = e.key.length === 1 && (e.key !== ' ' || state.buffer !== '')
    if (!isChar) return
    e.preventDefault()
    window.clearTimeout(state.timer)
    state.buffer += e.key
    state.timer = window.setTimeout(() => {
      state.buffer = ''
    }, TYPEAHEAD_RESET_MS)
    const labels = els.map((el) => el.dataset.label ?? el.textContent ?? '')
    focusAt(typeaheadIndex(labels, enabled, current, state.buffer))
  }

  // Hovering moves the highlight (which is focus); leaving the menu clears it.
  const onMenuPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return
    const item = (e.target as HTMLElement).closest<HTMLElement>('[role="menuitem"]')
    if (item && isEnabled(item)) {
      if (document.activeElement !== item) item.focus({ preventScroll: true })
    } else if (!item) {
      e.currentTarget.focus({ preventScroll: true })
    }
  }

  const triggerProps: DropdownTriggerProps = {
    ref: setAnchor,
    id: triggerId,
    onClick: onTriggerClick,
    onKeyDown: onTriggerKeyDown,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
  }

  return (
    <>
      {trigger(triggerProps)}
      <FloatingLayer
        open={open}
        anchor={anchor}
        onDismiss={close}
        side={side}
        align={align}
        offset={offset}
        matchAnchorWidth={matchTriggerWidth}
        contentRef={setMenuRefs}
        closeOnAnyTab
        id={menuId}
        role="menu"
        tabIndex={-1}
        aria-orientation="vertical"
        aria-label={label}
        aria-labelledby={label ? undefined : triggerId}
        className={styles.menu}
        onKeyDown={onMenuKeyDown}
        onPointerMove={onMenuPointerMove}
      >
        <MenuItems entries={items} onChoose={onChoose} emptyLabel={emptyLabel} />
      </FloatingLayer>
    </>
  )
}
