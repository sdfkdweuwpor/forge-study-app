import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AccentId, TagColor } from '@/db/types'

/*
 * WCAG AA for the design tokens (BRIEF §3.2 "check that all text meets WCAG AA").
 * Parses tokens.css / accents.css / tags.css, resolves var() chains, composites rgba() over the
 * surface it sits on, and checks every text/background pair in both themes and every accent:
 *   4.5:1  text: --text, --text-muted, --*-text, --accent-contrast on --accent, tag text on tag bg
 *   3:1    --text-faint (large text, icons, disabled only) and non-text fills/rings
 *          (--accent, --success, --warning, --danger, --xp, tag text used as a dot)
 * Surfaces are --bg, --bg-sidebar and --bg-elevated, each plain, hovered and active. --bg-raised
 * (the segmented-control thumb) only ever holds --text / --text-muted labels and is checked for those.
 */

const STYLES = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(STYLES, '..')
const read = (file: string) => readFileSync(join(STYLES, file), 'utf8')

const ACCENTS = ['blue', 'teal', 'green', 'orange', 'pink', 'graphite'] as const
const TAGS = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const
const STATUSES = ['success', 'warning', 'danger', 'xp'] as const
// Compile-time: the lists above cover every AccentId / TagColor.
const accentsCovered: [Exclude<AccentId, (typeof ACCENTS)[number]>] extends [never] ? true : false =
  true
const tagsCovered: [Exclude<TagColor, (typeof TAGS)[number]>] extends [never] ? true : false = true

const AA_TEXT = 4.5
const AA_LARGE_OR_UI = 3

// ── Minimal CSS parsing ──────────────────────────────────────────────────────────────────────────

interface Rule {
  media: string | null
  selectors: string[]
  decls: Map<string, string>
}

function parseDecls(body: string): Map<string, string> {
  const decls = new Map<string, string>()
  for (const part of body.split(';')) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const name = part.slice(0, colon).trim()
    if (name)
      decls.set(
        name,
        part
          .slice(colon + 1)
          .trim()
          .replace(/\s+/g, ' '),
      )
  }
  return decls
}

function parseCss(source: string): Rule[] {
  const rules: Rule[] = []
  const walk = (text: string, media: string | null) => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open === -1) break
      const prelude = text.slice(i, open).trim()
      let depth = 1
      let j = open + 1
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++
        else if (text[j] === '}') depth--
        j++
      }
      const body = text.slice(open + 1, j - 1)
      if (prelude.startsWith('@media')) walk(body, prelude.slice('@media'.length).trim())
      else if (!prelude.startsWith('@')) {
        const selectors = prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' '))
        rules.push({ media, selectors, decls: parseDecls(body) })
      }
      i = j
    }
  }
  walk(source.replace(/\/\*[\s\S]*?\*\//g, ''), null)
  return rules
}

function block(rules: Rule[], selectors: string[], media: string | null = null) {
  const rule = rules.find((r) => r.media === media && r.selectors.join(',') === selectors.join(','))
  if (!rule) throw new Error(`No rule for ${selectors.join(', ')} ${media ?? ''}`)
  return rule.decls
}

const LIGHT = [':root', "[data-theme='light']"]
const DARK = ["[data-theme='dark']"]
const SYSTEM = [':root:not([data-theme])', "[data-theme='system']"]
const SYSTEM_MEDIA = '(prefers-color-scheme: dark)'

const tokenRules = parseCss(read('tokens.css'))
const tagRules = parseCss(read('tags.css'))
const accentRules = parseCss(read('accents.css'))

function accentBlock(id: string): Map<string, string> {
  const rule = accentRules.find(
    (r) => r.media === null && r.selectors.includes(`[data-accent='${id}']`),
  )
  if (!rule) throw new Error(`No accent block for ${id}`)
  return rule.decls
}

// ── Colour maths ─────────────────────────────────────────────────────────────────────────────────

type Rgba = readonly [number, number, number, number]

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex?.[1]) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    const channel = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return [channel(0), channel(2), channel(4), 1]
  }
  const fn =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(value)
  if (fn?.[1] && fn[2] && fn[3]) {
    const alpha = fn[4] === undefined ? 1 : Number(fn[4]) / (fn[5] ? 100 : 1)
    return [Number(fn[1]), Number(fn[2]), Number(fn[3]), alpha]
  }
  throw new Error(`Unsupported colour "${value}" (use hex or rgba())`)
}

/** Source-over compositing of `fg` on `bg`. */
function over(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3] + bg[3] * (1 - fg[3])
  if (a === 0) return [0, 0, 0, 0]
  const ch = (i: 0 | 1 | 2) => (fg[i] * fg[3] + bg[i] * bg[3] * (1 - fg[3])) / a
  return [ch(0), ch(1), ch(2), a]
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Contrast of `fg` drawn on the opaque `bg` (rgba foregrounds are composited first). */
function contrast(fg: Rgba, bg: Rgba): number {
  if (bg[3] !== 1) throw new Error('contrast() needs an opaque background')
  const a = luminance(over(fg, bg))
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

// ── Theme model ──────────────────────────────────────────────────────────────────────────────────

type ThemeName = 'light' | 'dark'

interface Surface {
  name: string
  color: Rgba
}

function themeScope(theme: ThemeName, accent: string): Map<string, string> {
  const selectors = theme === 'light' ? LIGHT : DARK
  return new Map([
    ...accentBlock(accent),
    ...block(tokenRules, selectors),
    ...block(tagRules, selectors),
  ])
}

function colorOf(scope: Map<string, string>, name: string, seen: string[] = []): Rgba {
  const value = scope.get(name)
  if (value === undefined) throw new Error(`${name} is not defined (via ${seen.join(' → ')})`)
  const ref = /^var\((--[\w-]+)\)$/.exec(value)
  if (ref?.[1]) return colorOf(scope, ref[1], [...seen, name])
  return parseColor(value)
}

const BASE_SURFACES = ['--bg', '--bg-sidebar', '--bg-elevated'] as const

function surfaces(scope: Map<string, string>): Surface[] {
  const out: Surface[] = []
  for (const base of BASE_SURFACES) {
    const b = colorOf(scope, base)
    expect(b[3], `${base} must be opaque`).toBe(1)
    out.push({ name: base, color: b })
    for (const overlay of ['--bg-hover', '--bg-active'])
      out.push({ name: `${overlay} on ${base}`, color: over(colorOf(scope, overlay), b) })
  }
  return out
}

function bases(scope: Map<string, string>): Surface[] {
  return BASE_SURFACES.map((name) => ({
    name,
    color: colorOf(scope, name),
  }))
}

/** `soft` composited over each base: the tinted rows/callouts coloured text sits on. */
function tinted(scope: Map<string, string>, soft: string): Surface[] {
  return bases(scope).map((b) => ({
    name: `${soft} on ${b.name}`,
    color: over(colorOf(scope, soft), b.color),
  }))
}

/** Returns a readable line for every pair under `min`; an empty list means all pass. */
function failures(scope: Map<string, string>, fg: string, on: Surface[], min: number): string[] {
  const color = colorOf(scope, fg)
  return on
    .map((s) => ({ s, ratio: contrast(color, s.color) }))
    .filter(({ ratio }) => ratio < min)
    .map(({ s, ratio }) => `${fg} on ${s.name}: ${ratio.toFixed(2)} < ${min}`)
}

// ── Tests ────────────────────────────────────────────────────────────────────────────────────────

describe('token files', () => {
  it('covers every AccentId and TagColor', () => {
    expect(accentsCovered && tagsCovered).toBe(true)
    for (const id of ACCENTS) expect(() => accentBlock(id)).not.toThrow()
    const light = block(tagRules, LIGHT)
    for (const tag of TAGS) {
      expect(light.has(`--tag-${tag}-bg`), tag).toBe(true)
      expect(light.has(`--tag-${tag}-text`), tag).toBe(true)
    }
  })

  it('every accent preset defines the same raw variables', () => {
    const names = (id: string) => [...accentBlock(id).keys()].sort()
    const expected = names('blue')
    expect(expected).toHaveLength(10)
    for (const id of ACCENTS) expect(names(id), id).toEqual(expected)
  })

  it('light and dark define the same token names', () => {
    for (const rules of [tokenRules, tagRules]) {
      expect([...block(rules, DARK).keys()].sort()).toEqual([...block(rules, LIGHT).keys()].sort())
    }
  })

  it('the prefers-color-scheme block repeats the dark block exactly', () => {
    for (const rules of [tokenRules, tagRules]) {
      expect(Object.fromEntries(block(rules, SYSTEM, SYSTEM_MEDIA))).toEqual(
        Object.fromEntries(block(rules, DARK)),
      )
    }
  })
})

describe.each<ThemeName>(['light', 'dark'])('WCAG AA, %s theme', (theme) => {
  const scope = themeScope(theme, 'blue')

  it('--text and --text-muted reach 4.5:1 on every surface, hovered and active', () => {
    const on = surfaces(scope)
    expect([
      ...failures(scope, '--text', on, AA_TEXT),
      ...failures(scope, '--text-muted', on, AA_TEXT),
    ]).toEqual([])
  })

  it('--text-faint reaches 3:1 on every surface (large text, icons and disabled only)', () => {
    expect(failures(scope, '--text-faint', surfaces(scope), AA_LARGE_OR_UI)).toEqual([])
  })

  it('--text and --text-muted reach 4.5:1 on --bg-raised, and it is opaque', () => {
    const raised = colorOf(scope, '--bg-raised')
    expect(raised[3]).toBe(1)
    const on = [{ name: '--bg-raised', color: raised }]
    expect([
      ...failures(scope, '--text', on, AA_TEXT),
      ...failures(scope, '--text-muted', on, AA_TEXT),
      ...failures(scope, '--text-faint', on, AA_LARGE_OR_UI),
    ]).toEqual([])
  })

  it('--text-inverse and --text-inverse-muted reach 4.5:1 on --bg-inverse', () => {
    const on = [{ name: '--bg-inverse', color: colorOf(scope, '--bg-inverse') }]
    expect([
      ...failures(scope, '--text-inverse', on, AA_TEXT),
      ...failures(scope, '--text-inverse-muted', on, AA_TEXT),
    ]).toEqual([])
  })

  it.each(STATUSES)('--%s: fill 3:1, text 4.5:1 on surfaces and on its soft tint', (status) => {
    expect([
      ...failures(scope, `--${status}`, bases(scope), AA_LARGE_OR_UI),
      ...failures(scope, `--${status}-text`, surfaces(scope), AA_TEXT),
      ...failures(scope, `--${status}-text`, tinted(scope, `--${status}-soft`), AA_TEXT),
    ]).toEqual([])
  })

  it.each(TAGS)('tag %s: text 4.5:1 on its background, 3:1 on the page as a dot', (tag) => {
    const bg = colorOf(scope, `--tag-${tag}-bg`)
    expect(bg[3], 'tag backgrounds are opaque').toBe(1)
    expect([
      ...failures(scope, `--tag-${tag}-text`, [{ name: `--tag-${tag}-bg`, color: bg }], AA_TEXT),
      ...failures(scope, `--tag-${tag}-text`, bases(scope), AA_LARGE_OR_UI),
    ]).toEqual([])
  })

  describe.each(ACCENTS)('accent %s', (accent) => {
    const s = themeScope(theme, accent)
    const fill = (name: string) => [{ name, color: colorOf(s, name) }]

    it('--accent-contrast reaches 4.5:1 on --accent and --accent-hover', () => {
      expect([
        ...failures(s, '--accent-contrast', fill('--accent'), AA_TEXT),
        ...failures(s, '--accent-contrast', fill('--accent-hover'), AA_TEXT),
      ]).toEqual([])
    })

    it('--accent (fills, focus ring) reaches 3:1 on every base surface', () => {
      expect(failures(s, '--accent', bases(s), AA_LARGE_OR_UI)).toEqual([])
    })

    it('--accent-text reaches 4.5:1 on every surface and on --accent-soft', () => {
      expect([
        ...failures(s, '--accent-text', surfaces(s), AA_TEXT),
        ...failures(s, '--accent-text', tinted(s, '--accent-soft'), AA_TEXT),
      ]).toEqual([])
    })

    it('--text and --text-muted stay 4.5:1 on a selected (--accent-soft) row', () => {
      const on = tinted(s, '--accent-soft')
      expect([
        ...failures(s, '--text', on, AA_TEXT),
        ...failures(s, '--text-muted', on, AA_TEXT),
      ]).toEqual([])
    })
  })
})

describe('custom property references', () => {
  it('every var(--x) used in src resolves to a declared custom property', () => {
    const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.(css|tsx?)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => readFileSync(join(SRC, f), 'utf8'))
    const declared = new Set<string>()
    const used = new Set<string>()
    for (const text of files) {
      for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) if (m[1]) declared.add(m[1])
      for (const m of text.matchAll(/['"](--[\w-]+)['"]\s*[:,]/g)) if (m[1]) declared.add(m[1])
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) if (m[1]) used.add(m[1])
    }
    expect([...used].filter((name) => !declared.has(name)).sort()).toEqual([])
  })
})
