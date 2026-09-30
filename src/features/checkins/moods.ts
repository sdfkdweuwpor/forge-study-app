/** The mood chips after a check-in, in the order they are shown. The name is what a screen reader says. */
export interface Mood {
  emoji: string
  name: string
}

export const MOODS: readonly Mood[] = [
  { emoji: '😌', name: 'Calm' },
  { emoji: '🙂', name: 'Good' },
  { emoji: '😐', name: 'Meh' },
  { emoji: '😣', name: 'Strained' },
  { emoji: '😴', name: 'Tired' },
]

/** The ratings, 1 to 5. */
export const RATINGS = [1, 2, 3, 4, 5] as const
export type Rating = (typeof RATINGS)[number]
