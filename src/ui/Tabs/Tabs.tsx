import { useId, useRef, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../internal/cx'
import type { ForceProps } from '../internal/force'
import { nextIndex } from '../internal/roving'
import { useControllable } from '../internal/useControllable'
import { useIndicator } from '../internal/useIndicator'
import styles from './Tabs.module.css'

export interface TabItem<V extends string> {
  value: V
  label: ReactNode
  icon?: ReactNode
  /** Quiet count after the label ("Tasks 12"). */
  count?: number
  disabled?: boolean
}

export interface TabsProps<V extends string>
  extends Omit<ComponentProps<'div'>, 'onChange' | 'defaultValue' | 'children'>,
    ForceProps {
  items: readonly TabItem<V>[]
  value?: V
  defaultValue?: V
  onValueChange?: (value: V) => void
  /** Accessible name of the tablist, e.g. "Course sections". */
  label: string
  /** auto: arrows select as they move (default). manual: arrows move focus, Enter/Space select. */
  activation?: 'auto' | 'manual'
  size?: 'sm' | 'md'
  /** Renders the panel for the selected tab inside role="tabpanel". Omit for tabs that drive a route. */
  children?: (value: V) => ReactNode
}

/**
 * Tabs with an underline that slides to the selection. One Tab stop (the selected tab),
 * ←/→ move, Home/End jump, disabled tabs are skipped. The strip scrolls sideways on narrow screens.
 */
export function Tabs<V extends string>({
  items,
  value,
  defaultValue,
  onValueChange,
  label,
  activation = 'auto',
  size = 'md',
  children,
  className,
  'data-force': force,
  ...rest
}: TabsProps<V>) {
  const base = useId()
  const [selected, setSelected] = useControllable<V | undefined>(
    value,
    defaultValue ?? items[0]?.value,
    onValueChange as ((v: V | undefined) => void) | undefined,
  )
  const listRef = useRef<HTMLDivElement | null>(null)
  const barRef = useRef<HTMLSpanElement | null>(null)
  useIndicator(listRef, barRef, '[aria-selected="true"]', `${selected}|${items.length}`)

  const isDisabled = items.map((t) => !!t.disabled)
  const selectedIndex = items.findIndex((t) => t.value === selected)
  const tabStop = selectedIndex >= 0 ? selectedIndex : isDisabled.indexOf(false)
  const tabId = (v: V) => `${base}-tab-${v}`
  const panelId = (v: V) => `${base}-panel-${v}`

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextIndex(e.key, index, isDisabled, 'horizontal')
    const item = next === null ? undefined : items[next]
    if (next === null || !item) return
    e.preventDefault()
    const tab = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]
    tab?.focus()
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (activation === 'auto') setSelected(item.value)
  }

  return (
    <div className={cx(styles.tabs, className)} data-size={size} data-force={force} {...rest}>
      <div ref={listRef} role="tablist" aria-label={label} className={styles.list}>
        {items.map((t, i) => {
          const isSelected = i === selectedIndex
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              id={tabId(t.value)}
              aria-selected={isSelected}
              aria-controls={children && isSelected ? panelId(t.value) : undefined}
              tabIndex={i === tabStop ? 0 : -1}
              disabled={t.disabled}
              className={styles.tab}
              onClick={() => setSelected(t.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {t.icon != null && (
                <span className={styles.icon} aria-hidden="true">
                  {t.icon}
                </span>
              )}
              <span>{t.label}</span>
              {t.count != null && <span className={styles.count}>{t.count}</span>}
            </button>
          )
        })}
        <span ref={barRef} className={styles.indicator} aria-hidden="true" />
      </div>
      {children && selected !== undefined && (
        <div
          role="tabpanel"
          id={panelId(selected)}
          aria-labelledby={tabId(selected)}
          tabIndex={0}
          className={styles.panel}
        >
          {children(selected)}
        </div>
      )}
    </div>
  )
}
