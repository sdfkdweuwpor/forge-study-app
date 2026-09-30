/**
 * The level-up moment (BRIEF §3.5): a centred, full-screen card, "Level 8" in 40px bold, a short warm
 * line, and a burst of small square confetti in the nine tag colours on a canvas. Under 1.5 s, then it
 * leaves by itself; a click or Esc ends it early (it fades). It plays a sound when sound is on. With
 * reduced motion there is no confetti and nothing moves: it only fades in and out.
 *
 * Everything that changes over time is computed from one clock (`levelUpFrame`, `confettiPose`) on each
 * animation frame and written straight to the DOM, so there are no CSS animations to fall out of step
 * with the canvas, and a paused clock holds exactly one frame.
 */
import { useEffect, useRef, useState } from 'react'
import { useTheme } from '@/app/providers/ThemeProvider'
import { useShortcutHandler } from '@/app/shortcuts'
import { useSettings } from '@/db/hooks/useSettings'
import { levelUpFrame, makeConfetti } from '@/logic/levelUpMotion'
import { TAG_COLORS } from '@/ui/Tag'
import { drawConfetti, readConfettiPalette } from './LevelUpConfetti'
import { levelUpLine } from './LevelUpLines'
import styles from './LevelUp.module.css'

const CONFETTI_COUNT = 63

interface MomentProps {
  level: number
  /** The moment is over; remove it. */
  onDone: () => void
}

export default function LevelUpMoment({ level, onDone }: MomentProps) {
  const { reducedMotion } = useTheme()
  const settings = useSettings()
  const rootRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const startedAt = useRef<number | null>(null)
  const dismissedAt = useRef<number | null>(null)
  const done = useRef(onDone)
  const [announced, setAnnounced] = useState(false)

  useEffect(() => {
    done.current = onDone
  })

  const dismiss = () => {
    if (startedAt.current !== null && dismissedAt.current === null) {
      dismissedAt.current = performance.now() - startedAt.current
    }
  }
  useShortcutHandler('app.escape', dismiss)

  // The sound: once, when the moment begins. A quiet failure (audio blocked, unsupported) is fine.
  const soundOn = settings?.sound.enabled ?? false
  const volume = settings?.sound.volume
  const played = useRef(false)
  useEffect(() => {
    if (played.current || settings === undefined) return
    played.current = true
    if (!soundOn) return
    void import('@/lib/audio').then((audio) => audio.playLevelUp(volume)).catch(() => undefined)
  }, [settings, soundOn, volume])

  // A live region has to exist before its text does for the text to be read out.
  useEffect(() => {
    const id = window.setTimeout(() => setAnnounced(true), 60)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    const root = rootRef.current
    const card = cardRef.current
    const canvas = canvasRef.current
    if (!root || !card) return undefined
    const ctx = reducedMotion ? null : (canvas?.getContext('2d') ?? null)
    const palette = readConfettiPalette(root)
    const pieces = makeConfetti(level, CONFETTI_COUNT, TAG_COLORS.length)
    const start = performance.now()
    startedAt.current = start
    dismissedAt.current = null
    let raf = 0

    const tick = () => {
      const elapsed = performance.now() - start
      const frame = levelUpFrame(elapsed, reducedMotion, dismissedAt.current)
      root.style.opacity = String(frame.opacity)
      card.style.transform = frame.scale === 1 ? '' : `scale(${frame.scale})`
      if (ctx && canvas) {
        const w = root.clientWidth
        const h = root.clientHeight
        const dpr = window.devicePixelRatio || 1
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr)
          canvas.height = Math.round(h * dpr)
        }
        drawConfetti(ctx, pieces, palette, frame.confettiMs ?? -1, w, h, dpr)
      }
      if (frame.done) done.current()
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [level, reducedMotion])

  const line = levelUpLine(level)
  return (
    <div
      ref={rootRef}
      className={styles.root}
      style={{ opacity: 0 }}
      data-testid="level-up"
      data-level={level}
      data-reduced={reducedMotion || undefined}
    >
      <p className="sr-only" role="status">
        {announced ? `Level ${level}. ${line}` : ''}
      </p>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <button
        type="button"
        className={styles.surface}
        onClick={dismiss}
        data-testid="level-up-dismiss"
      >
        <span ref={cardRef} className={styles.card} aria-hidden="true">
          <span className={styles.level}>Level {level}</span>
          <span className={styles.rule} />
          <span className={styles.line}>{line}</span>
        </span>
        <span className="sr-only">Dismiss</span>
      </button>
    </div>
  )
}
