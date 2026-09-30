/**
 * When does a load of blocked.html count as a real blocked attempt? blocked.html is web-accessible
 * (the redirect needs it), so any page could frame it or open it to inflate the "wins" count. A
 * genuine attempt is the top frame of a tab, arrives by navigation (not a reload or Back), and has
 * no referrer: a DNR redirect from a typed URL or bookmark carries none.
 */
export interface AttemptContext {
  /** `window.top === window` */
  isTopFrame: boolean
  /** `document.referrer` */
  referrer: string
  /** `PerformanceNavigationTiming.type`, or '' when unknown. */
  navigationType: string
}

export function shouldLogAttempt(ctx: AttemptContext): boolean {
  return ctx.isTopFrame && ctx.referrer === '' && (ctx.navigationType === 'navigate' || ctx.navigationType === '')
}
