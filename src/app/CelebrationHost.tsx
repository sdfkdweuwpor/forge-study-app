import { useEffect } from 'react'
import { useToast } from '@/ui/Toast'
import { attachCelebrationHost } from './celebrate'

/**
 * Shows what `celebrate()` queues, as gold toasts. Renders nothing. It sits under the toast provider,
 * and toasts that arrived before it mounted (a reconcile at app start can finish first) are shown the
 * moment it does.
 */
export function CelebrationHost() {
  const toast = useToast()
  useEffect(
    () =>
      attachCelebrationHost(({ id, title, description }) => {
        toast.xp(title, description === undefined ? { id } : { id, description })
      }),
    [toast],
  )
  return null
}
