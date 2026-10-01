/**
 * Browser notifications, kept polite:
 *  - Nothing asks for permission on its own. `requestNotifyPermission()` is called from a button.
 *  - `notify()` does nothing unless permission is granted, and nothing while Forge is the visible,
 *    focused window: the in-app toast is enough there.
 *  - One tag, so a new notification replaces the previous one instead of stacking.
 *
 * Everything reads `Notification` and `document` through `globalThis`, so tests can stub them.
 */

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported'

export interface NotifyOptions {
  /** Replaces any earlier notification with the same tag. Default `forge`. */
  tag?: string
  /** Show even while the app is visible and focused (a "send a test" button). */
  force?: boolean
  /** Icon URL. Default: the PNG app icon (notifications do not draw SVG). */
  icon?: string
  /** Do not let the OS play its own sound (Forge plays its own chime). Default true. */
  silent?: boolean
  /** Runs when the notification is clicked, after the window has been focused. */
  onClick?: () => void
}

interface NotificationLike {
  onclick: ((this: unknown, ev: unknown) => unknown) | null
  close(): void
}

interface NotificationCtor {
  new (title: string, options?: NotificationOptions): NotificationLike
  readonly permission: NotificationPermission
  requestPermission(
    callback?: (permission: NotificationPermission) => void,
  ): Promise<NotificationPermission> | undefined
}

function ctor(): NotificationCtor | null {
  const n = (globalThis as { Notification?: NotificationCtor }).Notification
  return n ?? null
}

const DEFAULT_TAG = 'forge'

/** Notifications need a raster image; `scripts/icons.mjs` draws this one from `public/favicon.svg`. */
function iconUrl(): string {
  return `${import.meta.env.BASE_URL}icons/notify-192.png`
}

const listeners = new Set<() => void>()
let watching = false

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** The current permission, or `unsupported` where the Notification API is missing. */
export function notifyPermission(): NotifyPermission {
  const N = ctor()
  if (!N) return 'unsupported'
  const p = N.permission
  return p === 'granted' || p === 'denied' || p === 'default' ? p : 'default'
}

/**
 * Asks the browser for permission, only if it has not been decided yet (asking again after a "no"
 * cannot show a prompt, so it just reports the state). Resolves to the resulting permission and never
 * rejects. Call it from a click handler: browsers ignore prompts that were not a user's doing.
 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  const N = ctor()
  if (!N) return 'unsupported'
  if (N.permission !== 'default') return notifyPermission()
  try {
    // Older Safari takes a callback and returns nothing; modern browsers return a promise.
    await new Promise<void>((resolve, reject) => {
      const result = N.requestPermission(() => resolve())
      if (result) result.then(() => resolve(), reject)
    })
  } catch {
    /* the request itself failed (blocked context): fall through to the state we have */
  }
  emit()
  return notifyPermission()
}

/**
 * Calls `listener` when the permission may have changed: after `requestNotifyPermission()`, when the
 * tab regains focus (the person may have changed it in site settings), and on the Permissions API's
 * own change event. Made for `useSyncExternalStore(subscribe, notifyPermission)`.
 */
export function subscribeNotifyPermission(listener: () => void): () => void {
  listeners.add(listener)
  if (!watching && typeof document !== 'undefined') {
    watching = true
    document.addEventListener('visibilitychange', emit)
    globalThis.addEventListener?.('focus', emit)
    void watchPermissionApi()
  }
  return () => {
    listeners.delete(listener)
  }
}

async function watchPermissionApi(): Promise<void> {
  try {
    const status = await navigator.permissions.query({ name: 'notifications' })
    status.addEventListener('change', emit)
  } catch {
    /* Permissions API missing or does not know "notifications" */
  }
}

/** True while Forge is the window the person is looking at. */
function appInFront(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'visible' && document.hasFocus()
}

/**
 * Shows a notification. Resolves true if one was shown; false if it was skipped (no permission, or
 * the app is in front) or the browser refused. Never rejects.
 */
export async function notify(
  title: string,
  body: string,
  opts: NotifyOptions = {},
): Promise<boolean> {
  const N = ctor()
  if (!N || N.permission !== 'granted') return false
  if (!opts.force && appInFront()) return false
  const options: NotificationOptions = {
    body,
    tag: opts.tag ?? DEFAULT_TAG,
    icon: opts.icon ?? iconUrl(),
    silent: opts.silent ?? true,
  }
  try {
    const n = new N(title, options)
    n.onclick = () => {
      globalThis.focus?.()
      opts.onClick?.()
      n.close()
    }
    return true
  } catch {
    // Chrome on Android refuses `new Notification`; the service worker can show it instead.
    return showViaServiceWorker(title, options)
  }
}

async function showViaServiceWorker(title: string, options: NotificationOptions): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) return false
    await registration.showNotification(title, options)
    return true
  } catch {
    return false
  }
}
