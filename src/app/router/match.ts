/** Pure path matching and building. No DOM, no React (see location.ts for the URL side). */

import { ROUTES, type Query, type RouteName } from './routes'

export interface MatchResult {
  name: RouteName
  params: Record<string, string>
}

interface Segment {
  kind: 'literal' | 'param' | 'optional'
  value: string
}

interface Compiled {
  name: RouteName
  segments: Segment[]
  wildcard: boolean
  /** Higher = more specific; ties break on segment count. */
  score: number
}

export function compilePattern(path: string): { segments: Segment[]; wildcard: boolean } {
  if (path === '*') return { segments: [], wildcard: true }
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((raw): Segment => {
      if (raw.startsWith(':')) {
        return raw.endsWith('?')
          ? { kind: 'optional', value: raw.slice(1, -1) }
          : { kind: 'param', value: raw.slice(1) }
      }
      return { kind: 'literal', value: raw }
    })
  return { segments, wildcard: false }
}

const compiled: Compiled[] = (Object.keys(ROUTES) as RouteName[])
  .filter((name) => name !== 'notFound')
  .map((name) => {
    const { segments, wildcard } = compilePattern(ROUTES[name].path)
    const score = segments.reduce(
      (s, seg) => s + (seg.kind === 'literal' ? 3 : seg.kind === 'param' ? 2 : 1),
      0,
    )
    return { name, segments, wildcard, score }
  })
  .sort((a, b) => b.score - a.score)

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Match `pathname` against one pattern; returns params or null. */
export function matchPattern(path: string, pathname: string): Record<string, string> | null {
  const { segments, wildcard } = compilePattern(path)
  if (wildcard) return {}
  const parts = pathname.split('/').filter(Boolean)
  const required = segments.filter((s) => s.kind !== 'optional').length
  if (parts.length < required || parts.length > segments.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const part = parts[i]
    if (!seg) return null
    if (part === undefined) {
      if (seg.kind !== 'optional') return null
      continue
    }
    if (seg.kind === 'literal') {
      if (seg.value !== part) return null
    } else {
      params[seg.value] = safeDecode(part)
    }
  }
  return params
}

/** Resolve a pathname to a route. Unknown paths resolve to `notFound`. */
export function matchRoute(pathname: string): MatchResult {
  for (const c of compiled) {
    const params = matchPattern(ROUTES[c.name].path, pathname)
    if (params) return { name: c.name, params }
  }
  return { name: 'notFound', params: {} }
}

/** Fill a pattern with params. Optional segments are dropped when absent. Throws on a missing required param. */
export function buildPath(path: string, params: Record<string, string | undefined> = {}): string {
  if (path === '*') return '/'
  const { segments } = compilePattern(path)
  const out: string[] = []
  for (const seg of segments) {
    if (seg.kind === 'literal') {
      out.push(seg.value)
      continue
    }
    const value = params[seg.value]
    if (value === undefined || value === '') {
      if (seg.kind === 'optional') continue
      throw new Error(`Missing route param "${seg.value}" for ${path}`)
    }
    out.push(encodeURIComponent(value))
  }
  return `/${out.join('/')}`
}

export function buildQuery(query?: Query): string {
  if (!query) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') sp.set(k, v)
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export function parseQuery(search: string): Record<string, string> {
  const out: Record<string, string> = {}
  new URLSearchParams(search).forEach((v, k) => {
    out[k] = v
  })
  return out
}
