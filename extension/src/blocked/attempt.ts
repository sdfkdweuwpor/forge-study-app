/**
 * When does a load of blocked.html count as a real blocked attempt (a "win")? blocked.html has to be
 * web-accessible for the redirect, so another page can frame it or link to it to inflate the count.
 * A genuine attempt is the top frame of a tab that arrived by a fresh navigation (not a reload or
 * Back/Forward). The service worker adds the rest: only blocklist domains, and only while they are
 * really blocked.
 *
 * `document.referrer` is deliberately NOT part of the test. Chrome keeps the original Referer through
 * a declarativeNetRequest redirect, so a click on an Instagram link from Google, Gmail or the LMS
 * arrives with a referrer, and requiring it to be empty would drop exactly the attempts worth
 * counting (checked in e2e/extension.spec.ts). A framed page is what the referrer would have caught,
 * and `isTopFrame` catches that directly.
 */
export interface AttemptContext {
  /** `window.top === window` */
  isTopFrame: boolean
  /** `PerformanceNavigationTiming.type`, or '' when the browser does not say. */
  navigationType: string
}

export function shouldLogAttempt(ctx: AttemptContext): boolean {
  return ctx.isTopFrame && (ctx.navigationType === 'navigate' || ctx.navigationType === '')
}
