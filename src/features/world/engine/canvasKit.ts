/**
 * The little canvas plumbing the renderer needs: off-screen layers that work with or without
 * `OffscreenCanvas`, and sprite bitmaps made from a sprite's rects. Nothing here knows about the city.
 */
import type { Rect, RectBounds } from './sprites'

/** The drawing calls the engine uses. Both canvas 2D context types satisfy it. */
export interface Draw2D {
  fillStyle: string | CanvasGradient | CanvasPattern
  globalAlpha: number
  globalCompositeOperation: GlobalCompositeOperation
  imageSmoothingEnabled: boolean
  imageSmoothingQuality: ImageSmoothingQuality
  font: string
  textBaseline: CanvasTextBaseline
  fillRect(x: number, y: number, w: number, h: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  drawImage(image: CanvasImageSource, dx: number, dy: number): void
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void
  fillText(text: string, x: number, y: number): void
  save(): void
  restore(): void
  beginPath(): void
  rect(x: number, y: number, w: number, h: number): void
  clip(): void
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient
}

/** A drawing surface of a fixed size: something to draw on and to draw from. */
export interface Layer {
  readonly surface: CanvasImageSource
  readonly ctx: Draw2D
  readonly width: number
  readonly height: number
  /** Encodes the layer as a PNG. */
  toPng(): Promise<Blob>
}

/** A layer of `width` x `height` pixels, on an `OffscreenCanvas` when the browser has one. */
export function createLayer(doc: Document, width: number, height: number): Layer {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.imageSmoothingEnabled = false
      return {
        surface: canvas,
        ctx,
        width: w,
        height: h,
        toPng: () => canvas.convertToBlob({ type: 'image/png' }),
      }
    }
  }
  const canvas = doc.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser cannot draw the world: 2D canvas is not available.')
  ctx.imageSmoothingEnabled = false
  return {
    surface: canvas,
    ctx,
    width: w,
    height: h,
    toPng: () =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))), 'image/png')
      }),
  }
}

/** A stamped sprite: a small bitmap and where its top-left lies relative to the sprite's origin. */
export interface Bitmap {
  layer: Layer
  /** Offset of the bitmap's top-left from the sprite origin (the footprint's top corner), in art pixels. */
  ox: number
  oy: number
  w: number
  h: number
}

/** Paints `rects` (art pixels, at 1x) onto a new layer sized to `bounds`. */
export function bitmapFromRects(doc: Document, rects: readonly Rect[], bounds: RectBounds): Bitmap {
  const w = bounds.x1 - bounds.x0
  const h = bounds.y1 - bounds.y0
  const layer = createLayer(doc, w, h)
  let last = ''
  for (const r of rects) {
    if (r.color !== last) {
      layer.ctx.fillStyle = r.color
      last = r.color
    }
    layer.ctx.fillRect(r.x - bounds.x0, r.y - bounds.y0, r.w, r.h)
  }
  return { layer, ox: bounds.x0, oy: bounds.y0, w, h }
}

/** The same bitmap filled with one colour wherever it has pixels: a silhouette for outlines. */
export function silhouetteOf(doc: Document, source: Bitmap, color: string): Bitmap {
  const layer = createLayer(doc, source.w, source.h)
  layer.ctx.drawImage(source.layer.surface, 0, 0)
  layer.ctx.globalCompositeOperation = 'source-in'
  layer.ctx.fillStyle = color
  layer.ctx.fillRect(0, 0, source.w, source.h)
  layer.ctx.globalCompositeOperation = 'source-over'
  return { layer, ox: source.ox, oy: source.oy, w: source.w, h: source.h }
}
