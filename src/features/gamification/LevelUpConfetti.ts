import { CONFETTI_MS, confettiPose, type ConfettiPiece } from '@/logic/levelUpMotion'
import { TAG_COLORS } from '@/ui/Tag'

/** The nine tag text colours, resolved for the theme that is showing (a canvas cannot read `var()`). */
export function readConfettiPalette(element: Element): string[] {
  const style = getComputedStyle(element)
  return TAG_COLORS.map(
    (name) => style.getPropertyValue(`--tag-${name}-text`).trim() || 'CanvasText',
  )
}

/**
 * Draws one frame of the confetti: small squares in the tag colours, `ms` after the moment began. The
 * canvas is `width × height` CSS pixels at `dpr` device pixels per CSS pixel.
 */
export function drawConfetti(
  ctx: CanvasRenderingContext2D,
  pieces: readonly ConfettiPiece[],
  palette: readonly string[],
  ms: number,
  width: number,
  height: number,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  if (ms < 0 || ms >= CONFETTI_MS) return
  for (const piece of pieces) {
    const pose = confettiPose(piece, ms, width, height)
    if (!pose) continue
    ctx.save()
    ctx.globalAlpha = pose.alpha
    ctx.translate(pose.x, pose.y)
    ctx.rotate(pose.rotation)
    ctx.fillStyle = palette[piece.color] ?? 'CanvasText'
    ctx.fillRect(-pose.size / 2, -pose.size / 2, pose.size, pose.size)
    ctx.restore()
  }
}
