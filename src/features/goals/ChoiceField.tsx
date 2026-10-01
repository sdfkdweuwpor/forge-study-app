import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { cx } from '@/ui/internal/cx'
import styles from './ChoiceField.module.css'

export interface Choice<V extends string> {
  value: V
  label: string
  /** Leading mark in the menu and on the button (a status dot, say). */
  mark?: ReactNode
}

export interface ChoiceFieldProps<V extends string> {
  value: V
  choices: readonly Choice<V>[]
  onChange: (value: V) => void
  /** Accessible name: "Status", "Course type". */
  label: string
  /** What the button shows; defaults to the current choice's mark and label. */
  display?: ReactNode
  /** Hide the chevron (table cells that should read as text). */
  quiet?: boolean
  /** Size to the text and never truncate it (a fact on a page, not a cell in a table). */
  fit?: boolean
  className?: string
}

/** A value picked from a short menu, in place: a button that looks like text until hovered. */
export function ChoiceField<V extends string>({
  value,
  choices,
  onChange,
  label,
  display,
  quiet = false,
  fit = false,
  className,
}: ChoiceFieldProps<V>) {
  const current = choices.find((c) => c.value === value)
  const items: MenuEntry[] = choices.map((c) => ({
    id: c.value,
    label: c.label,
    icon: c.value === value ? <Check /> : undefined,
    onSelect: () => {
      if (c.value !== value) onChange(c.value)
    },
  }))
  return (
    <Dropdown
      label={label}
      items={items}
      trigger={(p) => (
        <button
          {...p}
          type="button"
          className={cx(styles.button, className)}
          data-quiet={quiet || undefined}
          data-fit={fit || undefined}
          aria-label={`${label}: ${current?.label ?? 'none'}. Change`}
        >
          {display ?? (
            <>
              {current?.mark}
              <span className={styles.text}>{current?.label ?? 'None'}</span>
            </>
          )}
          {quiet ? null : <ChevronDown className={styles.chevron} size={14} aria-hidden="true" />}
        </button>
      )}
    />
  )
}
