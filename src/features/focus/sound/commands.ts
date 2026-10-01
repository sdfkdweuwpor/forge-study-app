import { Bell, CloudRain, Coffee, ListMusic, VolumeX, Waves, AudioLines } from 'lucide-react'
import type { CommandDef, ShortcutDef } from '@/app/registry'
import { updateSettings } from '@/db/repos/settings'
import type { NoiseLayer } from '@/db/types'
import { playLayer, togglePlay } from './playToggle'

// What the commands do that needs more than a settings write lives in `./actions`, which loads when a
// sound command first runs (not with the app). `playToggle` stays a static import: it unlocks audio
// before its first `await`, while the key press that chose the command still counts as a gesture.
const soundActions = () => import('./actions')

/** Shortcut ids. `soundCommands` points at `AMBIENT_SHORTCUT_ID`, so register both lists together. */
export const AMBIENT_SHORTCUT_ID = 'focus.ambient'

/** Register in the focus feature's `shortcuts`. Active while the `focus` scope is on the stack. */
export const soundShortcuts: ShortcutDef[] = [
  {
    id: AMBIENT_SHORTCUT_ID,
    keys: 'a',
    description: 'Play or pause sound',
    group: 'Focus',
    scope: 'focus',
    run: () => void togglePlay(),
  },
]

/** "Sound: Rain": that layer at 40%, playing. Runs from the palette (an Enter key press, so sound may start). */
function layerCommand(
  layer: NoiseLayer,
  title: string,
  icon: CommandDef['icon'],
  keywords: string[],
): CommandDef {
  return {
    id: `command.sound.${layer}`,
    title: `Sound: ${title}`,
    group: 'Focus',
    icon,
    keywords: ['ambient', 'sound', 'noise', ...keywords],
    run: () => playLayer(layer, 0.4),
  }
}

/** Register in the focus feature's `commands`. */
export const soundCommands: CommandDef[] = [
  {
    id: 'command.sound.ambientToggle',
    title: 'Play/Pause sound',
    group: 'Focus',
    icon: Waves,
    keywords: ['ambient', 'sound', 'noise', 'music', 'mute', 'play', 'pause'],
    shortcutId: AMBIENT_SHORTCUT_ID,
    run: () => togglePlay(),
  },
  {
    id: 'command.sound.panel',
    title: 'Open sound panel',
    group: 'Focus',
    icon: ListMusic,
    keywords: ['sound', 'mixer', 'ambient', 'lofi', 'rain'],
    run: async (c) => {
      c.navigate('focus')
      await updateSettings({ sound: { device: { open: { sounds: true } } } })
    },
  },
  layerCommand('rain', 'Rain', CloudRain, ['rain', 'storm']),
  layerCommand('cafe', 'Café chatter', Coffee, ['cafe', 'coffee', 'murmur']),
  layerCommand('noise', 'Noise', AudioLines, ['brown', 'white', 'pink', 'static']),
  {
    id: 'command.sound.toggle',
    title: 'Turn all sounds on or off',
    group: 'Focus',
    icon: VolumeX,
    keywords: ['mute', 'unmute', 'silent', 'chime', 'volume'],
    run: async () => (await soundActions()).toggleSounds(),
  },
  {
    id: 'command.sound.notifications',
    title: 'Allow session notifications',
    group: 'Focus',
    icon: Bell,
    keywords: ['notification', 'notify', 'ping', 'alert', 'permission'],
    // `lib/notify` (with the prompt code) loads with the first sound command; the question here is only
    // whether the browser has the API and has not been asked.
    when: () => typeof Notification !== 'undefined' && Notification.permission === 'default',
    run: async () => {
      await (await soundActions()).allowNotifications()
    },
  },
]
