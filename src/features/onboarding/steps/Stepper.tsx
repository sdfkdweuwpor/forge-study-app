import { Minus, Plus } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { IconButton } from '@/ui/IconButton'
import styles from './Stepper.module.css'

export interface StepperProps {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  /** Accessible name of the whole control, e.g. "Pomodoros per day". */
  label: string
  /** What one unit is called in the spoken value ("pomodoro"). */
  unit: string
  id?: string
}

/**
 * A small number stepper. The value is a spin button (arrow keys, Home and End), and the two round
 * buttons are for a pointer or a finger, so the keyboard stops here once.
 */
export function Stepper({ value, onChange, min, max, label, unit, id }: StepperProps) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)))

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1
    if (e.key === 'Home') set(min)
    else if (e.key === 'End') set(max)
    else if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) set(value + step)
    else return
    e.preventDefault()
  }

  return (
    <div className={styles.stepper}>
      <IconButton
        variant="secondary"
        size="md"
        label={`Fewer ${unit}s`}
        icon={<Minus />}
        tabIndex={-1}
        disabled={value <= min}
        onClick={() => set(value - 1)}
      />
      <div
        id={id}
        className={styles.value}
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} ${unit}${value === 1 ? '' : 's'}`}
        onKeyDown={onKeyDown}
      >
        {value}
      </div>
      <IconButton
        variant="secondary"
        size="md"
        label={`More ${unit}s`}
        icon={<Plus />}
        tabIndex={-1}
        disabled={value >= max}
        onClick={() => set(value + 1)}
      />
    </div>
  )
}
