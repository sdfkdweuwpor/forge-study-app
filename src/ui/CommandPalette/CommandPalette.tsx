import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { Search } from 'lucide-react'
import { highlightSegments } from './highlight'
import { INITIAL_NAV_STATE, paletteNavReducer, resolveActive } from './paletteNav'
import type { PaletteGroup, PaletteItem } from './types'
import styles from './CommandPalette.module.css'

export type { PaletteGroup, PaletteItem } from './types'

export interface CommandPalettePanelProps {
  query: string
  onQueryChange: (query: string) => void
  groups: readonly PaletteGroup[]
  /** Enter or click on an item. The parent decides whether to close the palette. */
  onSelect: (item: PaletteItem) => void
  /** Esc, or the Cancel button on small screens. */
  onEscape?: () => void
  /** Results are still arriving: shows skeleton rows (three when there is nothing yet, else one). */
  loading?: boolean
  /** A search failed. Shown instead of "No results" when there is nothing to list. */
  error?: string | null
  onRetry?: () => void
  placeholder?: string
  /** Accessible name of the search field and the results list. */
  label?: string
  /** Initial highlighted item (demos and tests); defaults to the first result. */
  defaultActiveId?: string
  /** Focus the search field on mount. */
  autoFocus?: boolean
  /** Inline panels ignore the small-screen full-screen layout. */
  className?: string
}

const SKELETON_TITLE_WIDTHS = ['46%', '62%', '38%'] as const

/** The palette surface: search field, grouped results, states. Use `CommandPalette` for the overlay. */
export function CommandPalettePanel({
  query,
  onQueryChange,
  groups,
  onSelect,
  onEscape,
  loading = false,
  error = null,
  onRetry,
  placeholder = 'Search tasks, goals, pages and actions',
  label = 'Command palette',
  defaultActiveId,
  autoFocus = false,
  className,
}: CommandPalettePanelProps) {
  const uid = useId()
  const listId = `${uid}-list`
  const optionId = (itemId: string) => `${uid}-opt-${itemId}`

  const visibleGroups = useMemo(() => groups.filter((g) => g.items.length > 0), [groups])
  const selectable = useMemo(
    () => visibleGroups.flatMap((g) => g.items.filter((i) => !i.disabled)),
    [visibleGroups],
  )
  const ids = useMemo(() => selectable.map((i) => i.id), [selectable])
  const totalCount = useMemo(
    () => visibleGroups.reduce((n, g) => n + g.items.length, 0),
    [visibleGroups],
  )

  const [nav, dispatch] = useReducer(paletteNavReducer, {
    ...INITIAL_NAV_STATE,
    activeId: defaultActiveId ?? null,
  })
  const activeId = resolveActive(nav, ids)
  const activeItem = selectable.find((i) => i.id === activeId) ?? null

  const scroller = useRef<HTMLDivElement>(null)
  const optionEls = useRef(new Map<string, HTMLElement>())
  const followKeyboard = useRef(false)

  // Keep the keyboard-selected row visible. Pointer hover never scrolls (it is already in view).
  useLayoutEffect(() => {
    if (!followKeyboard.current) return
    followKeyboard.current = false
    if (activeId === null) return
    if (activeId === ids[0] && scroller.current) {
      scroller.current.scrollTop = 0
      return
    }
    optionEls.current.get(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId, ids])

  const hasItems = totalCount > 0
  const showError = !hasItems && !loading && Boolean(error)
  const showEmpty = !hasItems && !loading && !error
  const trimmed = query.trim()

  const announcement = loading
    ? 'Searching'
    : error && !hasItems
      ? error
      : hasItems
        ? `${totalCount} ${totalCount === 1 ? 'result' : 'results'}`
        : trimmed
          ? `No results for ${trimmed}`
          : 'No results'

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        followKeyboard.current = true
        dispatch({ type: 'next', ids })
        break
      case 'ArrowUp':
        e.preventDefault()
        followKeyboard.current = true
        dispatch({ type: 'prev', ids })
        break
      case 'Enter':
        if (activeItem) {
          e.preventDefault()
          onSelect(activeItem)
        }
        break
      case 'Escape':
        if (onEscape) {
          e.preventDefault()
          e.stopPropagation()
          onEscape()
        }
        break
    }
  }

  // Keep focus in the search field when an option is clicked (options are not tab stops).
  const keepFocus = (e: MouseEvent) => e.preventDefault()

  return (
    <div
      className={className ? `${styles.panel} ${className}` : styles.panel}
      data-has-items={hasItems || undefined}
    >
      <div className={styles.searchRow}>
        <Search size={18} className={styles.searchIcon} aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          className={styles.search}
          value={query}
          placeholder={placeholder}
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={hasItems}
          aria-controls={hasItems ? listId : undefined}
          aria-activedescendant={activeId !== null && hasItems ? optionId(activeId) : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the palette exists to be typed into
          autoFocus={autoFocus}
          onChange={(e) => {
            dispatch({ type: 'reset' })
            onQueryChange(e.target.value)
          }}
          onKeyDown={onKeyDown}
        />
        {onEscape ? (
          <>
            <kbd className={styles.escHint} aria-hidden="true">
              Esc
            </kbd>
            <button type="button" className={styles.cancel} onClick={onEscape}>
              Cancel
            </button>
          </>
        ) : null}
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      <div ref={scroller} className={styles.results}>
        {hasItems ? (
          <div
            id={listId}
            role="listbox"
            aria-label={`${label} results`}
            className={styles.listbox}
            onMouseDown={keepFocus}
          >
            {visibleGroups.map((group) => {
              const headingId = `${uid}-group-${group.id}`
              return (
                <div key={group.id} role="group" aria-labelledby={headingId} className={styles.group}>
                  <div id={headingId} role="presentation" className={styles.heading}>
                    {group.heading}
                  </div>
                  {group.items.map((item) => (
                    <PaletteRow
                      key={item.id}
                      item={item}
                      domId={optionId(item.id)}
                      active={item.id === activeId}
                      register={(el) => {
                        if (el) optionEls.current.set(item.id, el)
                        else optionEls.current.delete(item.id)
                      }}
                      onHover={() => dispatch({ type: 'hover', id: item.id })}
                      onSelect={() => onSelect(item)}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        ) : null}

        {loading ? (
          <div className={styles.skeletons} aria-hidden="true" data-testid="palette-loading">
            {SKELETON_TITLE_WIDTHS.slice(0, hasItems ? 1 : 3).map((width, i) => (
              <div key={width} className={styles.skeletonRow}>
                <span className={styles.skeletonIcon} />
                <span className={styles.skeletonTitle} style={{ width }} />
                {i === 0 && !hasItems ? <span className={styles.skeletonHint} /> : null}
              </div>
            ))}
          </div>
        ) : null}

        {showEmpty ? (
          <p className={styles.state} aria-hidden="true">
            {trimmed ? (
              <>
                No results for <strong className={styles.stateQuery}>{trimmed}</strong>
              </>
            ) : (
              'Nothing to show yet. Start typing to search.'
            )}
          </p>
        ) : null}

        {showError ? (
          <div className={styles.state} role="alert">
            <span>{error}</span>
            {onRetry ? (
              <button type="button" className={styles.retry} onClick={onRetry}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasItems ? (
        <div className={styles.footer} aria-hidden="true">
          <span className={styles.footerHint}>
            <kbd className={styles.key}>↑</kbd>
            <kbd className={styles.key}>↓</kbd>
            navigate
          </span>
          <span className={styles.footerHint}>
            <kbd className={styles.key}>↵</kbd>
            open
          </span>
          <span className={styles.footerHint}>
            <kbd className={styles.key}>Esc</kbd>
            close
          </span>
        </div>
      ) : null}
    </div>
  )
}

interface PaletteRowProps {
  item: PaletteItem
  domId: string
  active: boolean
  register: (el: HTMLElement | null) => void
  onHover: () => void
  onSelect: () => void
}

function PaletteRow({ item, domId, active, register, onHover, onSelect }: PaletteRowProps) {
  return (
    <button
      ref={register}
      id={domId}
      type="button"
      role="option"
      tabIndex={-1}
      className={styles.item}
      aria-selected={active}
      aria-disabled={item.disabled || undefined}
      data-active={active || undefined}
      onPointerMove={item.disabled ? undefined : onHover}
      onClick={item.disabled ? undefined : onSelect}
    >
      {item.icon ? (
        <span className={styles.itemIcon} aria-hidden="true">
          {item.icon}
        </span>
      ) : null}
      <span className={styles.itemText}>
        <span className={styles.itemTitle}>
          <Highlighted text={item.title} matches={item.matches} />
        </span>
        {item.subtitle ? (
          <span className={styles.itemSubtitle}>
            <Highlighted text={item.subtitle} matches={item.subtitleMatches} />
          </span>
        ) : null}
      </span>
      {item.shortcut && item.shortcut.length > 0 ? (
        <span className={styles.itemKeys} aria-hidden="true">
          {item.shortcut.map((part, i) => (
            <kbd key={`${i}:${part}`} className={styles.key}>
              {part}
            </kbd>
          ))}
        </span>
      ) : null}
    </button>
  )
}

function Highlighted({ text, matches }: { text: string; matches: readonly number[] | undefined }) {
  return (
    <>
      {highlightSegments(text, matches).map((seg, i) =>
        seg.hit ? (
          <span key={i} className={styles.hit}>
            {seg.text}
          </span>
        ) : (
          seg.text
        ),
      )}
    </>
  )
}

export interface CommandPaletteProps extends Omit<CommandPalettePanelProps, 'onEscape' | 'autoFocus'> {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Extra content, e.g. a hint under the results. */
  children?: ReactNode
}

/**
 * Modal command palette: a native `<dialog>` (focus trap, inert background, focus restored on
 * close) with a 640px panel 20vh from the top, full-screen below 640px. Presentational: the app
 * owns the query, the result groups and what a selection does.
 */
export function CommandPalette({ open, onOpenChange, children, ...panel }: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const close = () => onOpenChange(false)

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label={panel.label ?? 'Command palette'}
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      onClose={() => {
        if (open) close()
      }}
    >
      <div className={styles.scrim} role="presentation" onClick={close} />
      {open ? (
        <CommandPalettePanel {...panel} onEscape={close} autoFocus className={styles.overlayPanel} />
      ) : null}
      {open ? children : null}
    </dialog>
  )
}
