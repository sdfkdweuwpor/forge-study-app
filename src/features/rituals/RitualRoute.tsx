import { useEffect } from 'react'
import { navigate, useParams } from '@/app/router'
import { Skeleton } from '@/ui/Skeleton'
import { openRitualDialog } from './store'

/**
 * `/rituals/morning` and `/rituals/evening`: a link that opens the dialog over Today (for a bookmark, a
 * launcher shortcut or a reminder). The dialogs are not pages, so this only asks for the dialog and moves on
 * to Today, replacing its own history entry so Back does not return here. Any other kind lands on Today.
 */
export default function RitualRoute() {
  const { kind } = useParams<'ritual'>()
  useEffect(() => {
    if (kind === 'morning' || kind === 'evening') openRitualDialog(kind)
    navigate('today', undefined, { replace: true })
  }, [kind])
  return (
    <div role="status" aria-busy="true" aria-label="Opening">
      <Skeleton width={180} />
    </div>
  )
}
