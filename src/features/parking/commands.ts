import { CircleParking, Inbox } from 'lucide-react'
import type { CommandDef } from '@/app/registry'
import { openParking, requestParkedReview } from './store'

/** Palette commands (PLAN §5.11). Both work anywhere, with or without a session running. */
export const parkingCommands: CommandDef[] = [
  {
    id: 'command.parking.park',
    title: 'Park a thought',
    group: 'Focus',
    icon: CircleParking,
    keywords: ['distraction', 'urge', 'idea', 'later', 'note', 'remember', 'jot', 'p'],
    shortcutId: 'parking.open',
    run: (c) => {
      // The palette closes first, so the popover is what has the keyboard next.
      c.overlays.close('palette')
      openParking()
    },
  },
  {
    id: 'command.parking.review',
    title: 'Review parked thoughts',
    group: 'Review',
    icon: Inbox,
    keywords: ['parked', 'parking lot', 'distractions', 'thoughts', 'urges', 'convert', 'sort'],
    run: (c) => {
      c.overlays.close('palette')
      c.navigate('today')
      requestParkedReview()
    },
  },
]
