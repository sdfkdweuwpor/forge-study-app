import { Suspense, type ComponentType } from 'react'
import { ErrorBoundary } from '../ErrorBoundary'
import { useRegistry } from './RegistryContext'
import type { SlotId, SlotProps } from './slots'

/** Number of contributions for a slot (lets a wrapper hide its own chrome when the slot is empty). */
export function useSlotCount(id: SlotId): number {
  return useRegistry().slots(id).length
}

/**
 * Renders every contribution to a named slot, ordered. A contribution that throws renders nothing
 * and never takes the host page down.
 */
export function Slot<S extends SlotId>({ id, ...props }: { id: S } & SlotProps[S]) {
  const contributions = useRegistry().slots(id)
  if (contributions.length === 0) return null
  return (
    <>
      {contributions.map((c) => {
        const Component = c.component as ComponentType<SlotProps[S]>
        return (
          <ErrorBoundary key={c.id} fallback={() => null}>
            <Suspense fallback={null}>
              <Component {...(props as unknown as SlotProps[S])} />
            </Suspense>
          </ErrorBoundary>
        )
      })}
    </>
  )
}
