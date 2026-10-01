import { useCallback, useState } from 'react'

/**
 * Controlled/uncontrolled value in one hook: when `controlled` is defined the parent owns the
 * value, otherwise it lives here, seeded by `defaultValue`. `onChange` fires either way.
 */
export function useControllable<T>(
  controlled: T | undefined,
  defaultValue: T,
  onChange?: (value: T) => void,
): [T, (value: T) => void] {
  const [inner, setInner] = useState(defaultValue)
  const isControlled = controlled !== undefined
  const value = isControlled ? controlled : inner
  const setValue = useCallback(
    (next: T) => {
      if (!isControlled) setInner(next)
      onChange?.(next)
    },
    [isControlled, onChange],
  )
  return [value, setValue]
}
