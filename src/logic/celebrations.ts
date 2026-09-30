/**
 * The celebration queue (Phase 7C integration): one place that decides *when* and *as what* a gold
 * "you did it" toast reaches the screen. Streak XP, a badge, the daily goal and the level-up moment all
 * happen in the same second when a streak hits 7 days, and separate toasts pile up. So:
 *
 * - **Coalescing.** Celebrations that share a `mergeKey` and arrive within `windowMs` of the first one
 *   (or while it is still held back) become one toast: "7-day streak · +100 XP 🔥 · Badge unlocked". A celebration with no `mergeKey`
 *   stands alone. A second one with the same `id` replaces the first while it waits.
 * - **Settling.** Every celebration waits `windowMs` before it shows, which gives the level-up watcher
 *   (it reacts to the same XP a few milliseconds later) time to raise its moment first.
 * - **Deferral.** While the level-up moment is open (`hold()`), or no toast host is mounted yet, ready
 *   toasts wait and show in arrival order the moment both are clear. Nothing is dropped and nothing shows
 *   twice, so the order in which the app mounts and starts up never decides whether a toast is seen.
 *
 * Pure apart from timers (`setTimeout`, which tests fake), so it is unit-tested without a browser.
 */

/** How long a celebration waits for company (and for the level-up watcher) before it shows. */
export const CELEBRATION_WINDOW_MS = 300

/** More than this many waiting for a host at once means something is wrong; the oldest are dropped. */
const MAX_WAITING = 12

export interface Celebration {
  /** The toast's id. Pushing the same id again replaces the one that is still waiting. */
  id: string
  title: string
  description?: string
  /** Celebrations that share a key and arrive within the window show as one, e.g. `streak:7`. */
  mergeKey?: string
  /** Reading order inside a merged toast (lower first; the lead's title starts the line). Default 0. */
  order?: number
  /** What this adds to another celebration's title when they merge ("Badge unlocked"). Default: `title`. */
  joinAs?: string
}

/** What actually reaches the screen: one toast per group. */
export interface ToastRequest {
  id: string
  title: string
  description?: string
}

/**
 * Groups celebrations by `mergeKey` (in the order their first member arrived; keyless ones stand alone)
 * and joins each group into one toast. The lead (lowest `order`, then earliest) supplies the id and the
 * start of the title, the others add their `joinAs` after " · ", and the first description wins.
 */
export function mergeCelebrations(items: readonly Celebration[]): ToastRequest[] {
  const groups: Celebration[][] = []
  const byKey = new Map<string, Celebration[]>()
  for (const item of items) {
    const group = item.mergeKey === undefined ? undefined : byKey.get(item.mergeKey)
    if (group) {
      group.push(item)
      continue
    }
    const created = [item]
    groups.push(created)
    if (item.mergeKey !== undefined) byKey.set(item.mergeKey, created)
  }
  return groups.map((group) => {
    // Array.prototype.sort is stable, so equal orders keep their arrival order.
    const sorted = [...group].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const [lead, ...rest] = sorted
    if (!lead) throw new Error('a celebration group is never empty')
    const description = sorted.find((c) => c.description !== undefined)?.description
    const request: ToastRequest = {
      id: lead.id,
      title: [lead.title, ...rest.map((c) => c.joinAs ?? c.title)].join(' · '),
    }
    if (description !== undefined) request.description = description
    return request
  })
}

export interface CelebrationQueue {
  /** Adds a celebration; it shows after the window, merged with any that share its key. */
  push(celebration: Celebration): void
  /**
   * Holds every toast back (the level-up moment is open). Returns a release function; toasts show once
   * every hold has been released. Releasing twice is harmless.
   */
  hold(): () => void
  /** Connects the screen. Waiting toasts show at once; returns a function that disconnects it. */
  attach(show: (toast: ToastRequest) => void): () => void
  /** Forgets everything waiting and cancels timers (tests, hot reload). */
  reset(): void
}

interface Group {
  items: Celebration[]
  /** The window is over: the group may show as soon as nothing holds it back. */
  ready: boolean
  timer: ReturnType<typeof setTimeout> | null
}

export function createCelebrationQueue(windowMs: number = CELEBRATION_WINDOW_MS): CelebrationQueue {
  /** Toasts not shown yet, in the order their first celebration arrived. */
  let groups: Group[] = []
  let holds = 0
  let show: ((toast: ToastRequest) => void) | null = null

  const drain = (): void => {
    if (show === null || holds > 0) return
    while (groups[0]?.ready) {
      const group = groups.shift()
      if (!group) break
      for (const toast of mergeCelebrations(group.items)) show(toast)
    }
  }

  const open = (celebration: Celebration): void => {
    const group: Group = { items: [celebration], ready: false, timer: null }
    group.timer = setTimeout(() => {
      group.timer = null
      group.ready = true
      drain()
    }, windowMs)
    groups.push(group)
    // A host that never mounts must not grow the list for ever.
    while (groups.length > MAX_WAITING) {
      const dropped = groups.shift()
      if (dropped?.timer) clearTimeout(dropped.timer)
    }
  }

  return {
    push(celebration) {
      // Same id: it is the same news, so the newer wording replaces the older one.
      for (const group of groups) {
        const at = group.items.findIndex((c) => c.id === celebration.id)
        if (at !== -1) {
          group.items[at] = celebration
          return
        }
      }
      // A toast still waiting (its window is open, or the level-up moment holds it back) takes company.
      const joinable =
        celebration.mergeKey === undefined
          ? undefined
          : groups.find((g) => g.items.some((c) => c.mergeKey === celebration.mergeKey))
      if (joinable) joinable.items.push(celebration)
      else open(celebration)
    },

    hold() {
      holds += 1
      let released = false
      return () => {
        if (released) return
        released = true
        holds -= 1
        drain()
      }
    },

    attach(next) {
      show = next
      drain()
      return () => {
        if (show === next) show = null
      }
    },

    reset() {
      for (const group of groups) if (group.timer) clearTimeout(group.timer)
      groups = []
      holds = 0
      show = null
    },
  }
}
