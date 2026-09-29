import { useCallback, type Ref, type RefCallback } from 'react'

/** Writes `value` into a callback ref or a ref object. */
export function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

/** One stable callback ref that feeds two refs (the caller's and the component's own). */
export function useMergedRef<T>(a: Ref<T> | undefined, b: Ref<T> | undefined): RefCallback<T> {
  return useCallback(
    (node: T | null) => {
      assignRef(a, node)
      assignRef(b, node)
    },
    [a, b],
  )
}
