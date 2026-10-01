import type { Kind, Placed, WorldStats } from './types'

/** The words the page uses for the city: the stats line, tooltips and the legend. Pure. */

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** `42 tiles · 12 floors · 3 landmarks`. */
export function statsLine(stats: WorldStats): string {
  if (stats.tiles === 0 && stats.floors === 0 && stats.landmarks === 0) return 'Nothing built yet'
  return [count(stats.tiles, 'tile'), count(stats.floors, 'floor'), count(stats.landmarks, 'landmark')].join(' · ')
}

/** The same numbers as a sentence, for people who cannot see the canvas. */
export function describeWorld(stats: WorldStats): string {
  if (stats.tiles === 0 && stats.floors === 0 && stats.landmarks === 0) {
    return 'Your city is a single plot of grass, waiting for the first thing you finish.'
  }
  return `Your city has ${count(stats.tiles, 'tile')}, ${count(stats.floors, 'floor')} and ${count(stats.landmarks, 'landmark')}.`
}

const KIND_NAMES: Record<Kind, string> = {
  house: 'House',
  tree: 'Tree',
  lamp: 'Lamp post',
  block: 'Tower block',
  landmark: 'Landmark',
  monument: 'Monument',
  castle: 'Castle',
  road: 'Road',
  grass: 'Grass',
  decor: 'Shrub',
}

export function kindName(kind: Kind): string {
  return KIND_NAMES[kind]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** `Sep 29, 2026`, in the local time zone. */
export function formatEarnedDate(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}, ${d.getFullYear()}`
}

export interface TooltipText {
  /** Landmark, monument and castle labels lead; everything else says what it is. */
  title: string
  /** What it was earned from. */
  detail: string
  /** When, or an empty string. */
  date: string
}

export function tooltipText(item: Placed): TooltipText {
  return {
    title: item.label ?? kindName(item.kind),
    detail: item.earnedFrom ?? '',
    date: item.earnedAt === null ? '' : formatEarnedDate(item.earnedAt),
  }
}

/** One line of the legend: what appears in the city and what earns it. */
export interface LegendRow {
  kind: Kind
  name: string
  earns: string
}

export const LEGEND: readonly LegendRow[] = [
  { kind: 'house', name: 'House, tree or lamp post', earns: 'A finished task' },
  { kind: 'block', name: 'Tower block', earns: 'Each hour of focus adds a floor; six floors fill a block' },
  { kind: 'landmark', name: 'Landmark', earns: 'A finished course, named after it (C182 Tower)' },
  { kind: 'monument', name: 'Monument', earns: 'A finished goal' },
  { kind: 'castle', name: 'Castle', earns: 'A finished degree' },
]

/** What a growing streak adds. Nothing is ever taken away. */
export const STREAK_PERKS: readonly { days: number; perk: string }[] = [
  { days: 3, perk: 'Windows glow more at night' },
  { days: 7, perk: 'People walk the roads' },
  { days: 14, perk: 'Birds cross the sky' },
  { days: 30, perk: 'A fountain, and fireworks at night' },
]

/** How to move around, for the legend and the canvas description. */
export const CONTROLS: readonly { how: string; does: string }[] = [
  { how: 'Drag', does: 'Pan' },
  { how: 'Scroll, pinch, + and -', does: 'Zoom' },
  { how: 'Arrow keys', does: 'Pan (with the canvas focused)' },
  { how: 'Enter, then arrows', does: 'Step through what you have built' },
  { how: '0', does: 'Fit the whole city in view' },
]
