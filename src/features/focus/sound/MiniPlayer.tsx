/**
 * The "anytime, any page" sound control: Play/Pause, what is playing, and a volume popover. In the
 * sidebar footer (`sidebar.footer`, also inside the tablet drawer) and, on a phone, as a pill above the
 * tab bar (`global.overlays`). The label links to the Focus page's Sound card. Hidden where the browser
 * has no Web Audio.
 */
import { useEffect, useState } from 'react'
import { Pause, Play, Volume2 } from 'lucide-react'
import { Link } from '@/app/router'
import { isSilent, STYLE_LABELS } from '@/logic/soundMix'
import { IconButton, Popover } from '@/ui'
import { useBottomBarPill, BOTTOM_BAR_ATTR } from '@/app/hooks/useBottomBarPill'
import { audioAvailable, useMixer, useWantsSound } from './hooks'
import { setMaster } from './mixActions'
import { togglePlay } from './playToggle'
import { Slider } from './Slider'
import styles from './MiniPlayer.module.css'

interface Props {
  variant: 'sidebar' | 'pill'
  /** Closes the tablet drawer after the link is followed. */
  onNavigate?: () => void
}

/**
 * True while a drawer or sheet (the phone's More sheet) is open. The pill lives in `global.overlays`,
 * outside the shell's inert regions, so it must make itself unreachable behind the sheet's focus trap.
 */
function useBehindDrawer(enabled: boolean): boolean {
  const [behind, setBehind] = useState(false)
  useEffect(() => {
    if (!enabled) return undefined
    const check = () => setBehind(document.querySelector('[data-open][data-side]') !== null)
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-open'],
    })
    return () => observer.disconnect()
  }, [enabled])
  return behind && enabled
}

function Player({ variant, onNavigate }: Props) {
  const behindDrawer = useBehindDrawer(variant === 'pill')
  const mix = useMixer()
  const playing = useWantsSound()
  if (!audioAvailable() || !mix) return null
  const label =
    mix.music.style !== 'off'
      ? STYLE_LABELS[mix.music.style]
      : isSilent(mix)
        ? 'Sound off'
        : 'Sounds'

  return (
    <div
      role="group"
      aria-label="Sound player"
      className={styles.player}
      data-variant={variant}
      {...(variant === 'pill' ? { [BOTTOM_BAR_ATTR]: '' } : {})}
      inert={behindDrawer}
    >
      <IconButton
        label="Play sound"
        icon={playing ? <Pause /> : <Play />}
        pressed={playing}
        onClick={() => void togglePlay(playing)}
      />
      <Link to="focus" className={styles.label} onClick={onNavigate}>
        {label}
      </Link>
      <Popover
        label="Sound volume"
        side={variant === 'pill' ? 'top' : 'right'}
        trigger={(p) => <IconButton {...p} label="Sound volume" icon={<Volume2 />} />}
      >
        <div className={styles.volume}>
          <Slider label="Master volume" value={mix.master} onValueChange={setMaster} />
        </div>
      </Popover>
    </div>
  )
}

/** Slot `sidebar.footer`. */
export function MiniPlayer({ onNavigate }: { onNavigate?: () => void }) {
  return <Player variant="sidebar" onNavigate={onNavigate} />
}

/** Slot `global.overlays`; shown only below 640px by its CSS, and only while sound plays. */
export function MobilePlayer() {
  // Only while sound is playing: idle, people start it from the Focus page or the palette.
  return useWantsSound() ? <PillPlayer /> : null
}

function PillPlayer() {
  useBottomBarPill()
  return <Player variant="pill" />
}
