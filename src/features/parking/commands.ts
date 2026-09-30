import { CircleParking, Inbox } from 'lucide-react'
import type { CommandDef } from '@/app/registry'
import { isFocusSessionRunning, openParking, requestParkedReview, waitingThoughts } from './store'

/**
 * Palette commands (PLAN §5.11), offered when they help: parking while a focus session runs or on the
 * Focus page, reviewing when something is waiting. The palette matches a title by its letters in order
 * ("prog" finds "Park a thought"), so a command that is always there would sit above "Go to Progress"
 * for anyone who types the start of a page name.
 */
const onFocusPage = (): boolean => window.location.pathname.startsWith('/focus')

export const parkingCommands: CommandDef[] = [
  {
    id: 'command.parking.park',
    title: 'Park a thought',
    group: 'Focus',
    icon: CircleParking,
    keywords: ['distraction', 'urge', 'idea', 'later', 'note', 'remember', 'jot', 'p'],
    shortcutId: 'parking.open',
    when: () => isFocusSessionRunning() || onFocusPage(),
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
    when: () => waitingThoughts() > 0,
    run: (c) => {
      c.overlays.close('palette')
      c.navigate('today')
      requestParkedReview()
    },
  },
]
