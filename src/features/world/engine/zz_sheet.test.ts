import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { paintSprite, paintSoil, type Painter, type SpriteSpec } from './sprites'
import { paletteFor, skyAt, type Kind, type Theme } from '@/logic/world'

const OUT = '/tmp/claude-0/-home-user-forge-study-app/37c45e23-70d5-52b0-8a01-75a3e8d32e47/scratchpad/sheets'

function crc32(buf: Buffer): number {
  let c: number
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = (table[(crc ^ b) & 255] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
function parse(color: string): [number, number, number, number] {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(color)
  if (!m) throw new Error(color)
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
}

function sheet(theme: Theme, night: boolean, name: string, scale = 4) {
  const specs: { kind: Kind; variant: number; floors: number; label: string }[] = []
  for (let v = 0; v < 8; v++) specs.push({ kind: 'house', variant: v, floors: 0, label: '' })
  for (let v = 0; v < 8; v++) specs.push({ kind: 'tree', variant: v, floors: 0, label: '' })
  specs.push({ kind: 'lamp', variant: 0, floors: 0, label: '' })
  for (let f = 1; f <= 6; f++) specs.push({ kind: 'block', variant: f, floors: f, label: '' })
  for (let v = 0; v < 8; v++) specs.push({ kind: 'decor', variant: v, floors: 0, label: '' })
  const wide: { kind: Kind; variant: number }[] = [
    { kind: 'landmark', variant: 0 }, { kind: 'landmark', variant: 3 }, { kind: 'monument', variant: 0 }, { kind: 'castle', variant: 1 },
  ]
  const W = 16 * 40 * 2, H = 700
  const px = new Uint8Array(W * H * 4)
  const pal = paletteFor(theme)
  const sky = skyAt(night ? 22 * 60 : 12 * 60, theme)
  const [tr, tg, tb] = parse(sky.top)
  const [br, bg, bb] = parse(sky.bottom)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y / H
    const i = (y * W + x) * 4
    px[i] = tr + (br - tr) * t; px[i + 1] = tg + (bg - tg) * t; px[i + 2] = tb + (bb - tb) * t; px[i + 3] = 255
  }
  const blit = (rects: { x: number; y: number; w: number; h: number; color: string }[], ox: number, oy: number) => {
    for (const r of rects) {
      const [cr, cg, cb, ca] = parse(r.color)
      for (let y = r.y * scale; y < (r.y + r.h) * scale; y++) for (let x = r.x * scale; x < (r.x + r.w) * scale; x++) {
        const X = ox + x, Y = oy + y
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue
        const i = (Y * W + X) * 4
        px[i] = px[i] * (1 - ca) + cr * ca; px[i + 1] = px[i + 1] * (1 - ca) + cg * ca; px[i + 2] = px[i + 2] * (1 - ca) + cb * ca
      }
    }
  }
  const lit = night
  const place = (spec: Partial<SpriteSpec> & { kind: Kind }, cx: number, cy: number, cell = 1) => {
    // ground under it
    const n = cell
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) {
      const g = paintSprite({ kind: 'grass', id: 'g', variant: (dx + dy) % 3, floors: 0, theme, streakLevel: 0, lit: false, parity: (dx + dy) % 2 })
      blit(g.base, cx + (dx - dy) * 16 * scale, cy + (dx + dy) * 8 * scale)
    }
    const s = paintSprite({ id: `s-${spec.kind}-${spec.variant}`, variant: 0, floors: 0, theme, streakLevel: 2, lit, parity: 0, ...spec })
    blit(s.base, cx, cy)
    return s
  }
  let col = 0, row = 0
  for (const s of specs) {
    const cx = 60 + col * 70 * scale / 4 * 1.0 + 30, cy = 120 + row * 130
    place({ kind: s.kind, variant: s.variant, floors: s.floors, id: `b${s.variant}` }, cx, cy)
    col++
    if (col >= 8) { col = 0; row++ }
  }
  let x = 100
  for (const w of wide) {
    place({ kind: w.kind, variant: w.variant }, x, 460, w.kind === 'castle' ? 3 : 2)
    x += 300
  }
  writeFileSync(`${OUT}/${name}.png`, png(W, H, px))
  void pal
}

it('sheets', () => {
  sheet('light', false, 'light-day')
  sheet('dark', true, 'dark-night')
})
