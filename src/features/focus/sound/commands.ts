import { AudioLines, Bell, CloudRain, Coffee, VolumeX, Waves } from 'lucide-react'
import type { CommandDef, ShortcutDef } from '@/app/registry'
import { getSettings } from '@/db/repos/settings'
import { unlockAudio } from '@/lib/audio'
import { notifyPermission } from '@/lib/notify'
import { runtime } from '../runtime'
import { allowNotifications, chooseAmbient, toggleAmbient, toggleSounds } from './actions'

/** Shortcut ids. `soundCommands` points at `AMBIENT_SHORTCUT_ID`, so register both lists together. */
export const AMBIENT_SHORTCUT_ID = 'focus.ambient'

/** Register in the focus feature's `shortcuts`. Active while the `focus` scope is on the stack. */
export const soundShortcuts: ShortcutDef[] = [
  {
    id: AMBIENT_SHORTCUT_ID,
    keys: 'a',
    description: 'Play or pause ambient sound',
    group: 'Focus',
    scope: 'focus',
    run: () => {
      void toggleAmbient()
    },
  },
]

/** Runs `pick` for a bed, from the palette (an Enter key press, so sound may start). */
function ambientCommand(
  id: string,
  title: string,
  kind: 'brown' | 'rain' | 'cafe' | 'none',
  icon: CommandDef['icon'],
  keywords: string[],
): CommandDef {
  return {
    id,
    title,
    group: 'Focus',
    icon,
    keywords: ['ambient', 'sound', 'noise', ...keywords],
    run: async () => {
      if (runtime()?.soundEnabled()) void unlockAudio()
      const { sound } = await getSettings()
      await chooseAmbient(kind, sound.ambientVolume)
    },
  }
}

/** Register in the focus feature's `commands`. */
export const soundCommands: CommandDef[] = [
  {
    id: 'command.sound.ambientToggle',
    title: 'Play or pause ambient sound',
    group: 'Focus',
    icon: Waves,
    keywords: ['ambient', 'sound', 'noise', 'music', 'mute'],
    shortcutId: AMBIENT_SHORTCUT_ID,
    run: () => toggleAmbient(),
  },
  ambientCommand('command.sound.brown', 'Ambient sound: brown noise', 'brown', AudioLines, [
    'brown',
    'white',
    'static',
  ]),
  ambientCommand('command.sound.rain', 'Ambient sound: rain', 'rain', CloudRain, ['rain', 'storm']),
  ambientCommand('command.sound.cafe', 'Ambient sound: café', 'cafe', Coffee, [
    'cafe',
    'coffee',
    'murmur',
  ]),
  ambientCommand('command.sound.none', 'Ambient sound: none', 'none', VolumeX, ['off', 'silence']),
  {
    id: 'command.sound.toggle',
    title: 'Turn all sounds on or off',
    group: 'Focus',
    icon: VolumeX,
    keywords: ['mute', 'unmute', 'silent', 'chime', 'volume'],
    run: () => toggleSounds(),
  },
  {
    id: 'command.sound.notifications',
    title: 'Allow session notifications',
    group: 'Focus',
    icon: Bell,
    keywords: ['notification', 'notify', 'ping', 'alert', 'permission'],
    when: () => notifyPermission() === 'default',
    run: async () => {
      await allowNotifications()
    },
  },
]
