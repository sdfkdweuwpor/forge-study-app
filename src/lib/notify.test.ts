import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  notify,
  notifyPermission,
  requestNotifyPermission,
  subscribeNotifyPermission,
} from './notify'

type Permission = 'default' | 'granted' | 'denied'

interface FakeInstance {
  title: string
  options: NotificationOptions | undefined
  onclick: (() => void) | null
  close: ReturnType<typeof vi.fn>
}

/** A stand-in for the browser's Notification, with a permission the tests can move. */
function installNotification(
  initial: Permission,
  opts: {
    /** What a prompt answers (the person's choice). */
    answer?: Permission
    /** 'callback' mimics old Safari: no promise, result through the callback. */
    style?: 'promise' | 'callback' | 'throws'
    constructorThrows?: boolean
  } = {},
) {
  const instances: FakeInstance[] = []
  const requestPermission = vi.fn((callback?: (p: Permission) => void) => {
    if (opts.style === 'throws') throw new Error('not allowed here')
    Fake.permission = opts.answer ?? 'denied'
    if (opts.style === 'callback') {
      callback?.(Fake.permission)
      return undefined
    }
    return Promise.resolve(Fake.permission)
  })
  class Fake {
    static permission: Permission = initial
    static requestPermission = requestPermission
    title: string
    options: NotificationOptions | undefined
    onclick: (() => void) | null = null
    close = vi.fn()
    constructor(title: string, options?: NotificationOptions) {
      if (opts.constructorThrows) throw new TypeError('Illegal constructor')
      this.title = title
      this.options = options
      instances.push(this)
    }
  }
  vi.stubGlobal('Notification', Fake)
  return { instances, requestPermission, setPermission: (p: Permission) => (Fake.permission = p) }
}

function stubDocument(state: { visible: boolean; focused: boolean }) {
  vi.stubGlobal('document', {
    visibilityState: state.visible ? 'visible' : 'hidden',
    hasFocus: () => state.focused,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('notifyPermission', () => {
  it('reports unsupported when the browser has no Notification', () => {
    expect(notifyPermission()).toBe('unsupported')
  })

  it('reports the browser state', () => {
    const n = installNotification('default')
    expect(notifyPermission()).toBe('default')
    n.setPermission('granted')
    expect(notifyPermission()).toBe('granted')
    n.setPermission('denied')
    expect(notifyPermission()).toBe('denied')
  })
})

describe('requestNotifyPermission (permission state machine)', () => {
  it('unsupported stays unsupported', async () => {
    expect(await requestNotifyPermission()).toBe('unsupported')
  })

  it('default moves to granted when the person allows', async () => {
    const n = installNotification('default', { answer: 'granted' })
    expect(await requestNotifyPermission()).toBe('granted')
    expect(n.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('default moves to denied when the person refuses', async () => {
    installNotification('default', { answer: 'denied' })
    expect(await requestNotifyPermission()).toBe('denied')
  })

  it('never prompts again once granted or denied', async () => {
    const granted = installNotification('granted')
    expect(await requestNotifyPermission()).toBe('granted')
    expect(granted.requestPermission).not.toHaveBeenCalled()

    const denied = installNotification('denied')
    expect(await requestNotifyPermission()).toBe('denied')
    expect(denied.requestPermission).not.toHaveBeenCalled()
  })

  it('works with the old callback-style API', async () => {
    installNotification('default', { answer: 'granted', style: 'callback' })
    expect(await requestNotifyPermission()).toBe('granted')
  })

  it('does not throw when the request itself fails; the state stays default', async () => {
    installNotification('default', { style: 'throws' })
    expect(await requestNotifyPermission()).toBe('default')
  })

  it('tells subscribers the permission changed', async () => {
    stubDocument({ visible: true, focused: true })
    installNotification('default', { answer: 'granted' })
    const listener = vi.fn()
    const unsubscribe = subscribeNotifyPermission(listener)
    await requestNotifyPermission()
    expect(listener).toHaveBeenCalled()
    listener.mockClear()
    unsubscribe()
    await requestNotifyPermission()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('notify', () => {
  it('does nothing without permission', async () => {
    const n = installNotification('default')
    stubDocument({ visible: false, focused: false })
    expect(await notify('Session done', 'Nice work')).toBe(false)
    n.setPermission('denied')
    expect(await notify('Session done', 'Nice work')).toBe(false)
    expect(n.instances).toHaveLength(0)
  })

  it('does nothing where notifications are unsupported', async () => {
    expect(await notify('Session done', 'Nice work')).toBe(false)
  })

  it('shows one when granted and the app is in the background', async () => {
    const n = installNotification('granted')
    stubDocument({ visible: false, focused: false })
    expect(await notify('Session done', 'Nice work')).toBe(true)
    expect(n.instances).toHaveLength(1)
    const shown = n.instances[0]
    expect(shown?.title).toBe('Session done')
    expect(shown?.options?.body).toBe('Nice work')
    expect(shown?.options?.tag).toBe('forge')
    expect(shown?.options?.icon).toMatch(/favicon\.svg$/)
  })

  it('is skipped while the app is visible and focused: the in-app toast is enough', async () => {
    const n = installNotification('granted')
    stubDocument({ visible: true, focused: true })
    expect(await notify('Session done', 'Nice work')).toBe(false)
    expect(n.instances).toHaveLength(0)
  })

  it('still shows when the tab is visible but the window is not focused, or the tab is hidden', async () => {
    const n = installNotification('granted')
    stubDocument({ visible: true, focused: false })
    expect(await notify('a', 'b')).toBe(true)
    stubDocument({ visible: false, focused: true })
    expect(await notify('a', 'b')).toBe(true)
    expect(n.instances).toHaveLength(2)
  })

  it('force shows it even in front (for a test button)', async () => {
    const n = installNotification('granted')
    stubDocument({ visible: true, focused: true })
    expect(await notify('Test', 'Hello', { force: true })).toBe(true)
    expect(n.instances).toHaveLength(1)
  })

  it('passes a custom tag, so a new notification replaces the old one', async () => {
    const n = installNotification('granted')
    stubDocument({ visible: false, focused: false })
    await notify('a', 'b', { tag: 'break' })
    expect(n.instances[0]?.options?.tag).toBe('break')
  })

  it('runs the click handler and closes the notification', async () => {
    const n = installNotification('granted')
    stubDocument({ visible: false, focused: false })
    const onClick = vi.fn()
    await notify('a', 'b', { onClick })
    n.instances[0]?.onclick?.()
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(n.instances[0]?.close).toHaveBeenCalledTimes(1)
  })

  it('falls back to the service worker where `new Notification` is refused', async () => {
    installNotification('granted', { constructorThrows: true })
    stubDocument({ visible: false, focused: false })
    const showNotification = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistration: () => Promise.resolve({ showNotification }) },
    })
    expect(await notify('Session done', 'Nice work')).toBe(true)
    expect(showNotification).toHaveBeenCalledWith(
      'Session done',
      expect.objectContaining({ body: 'Nice work', tag: 'forge' }),
    )
  })

  it('reports false, without throwing, when nothing can show it', async () => {
    installNotification('granted', { constructorThrows: true })
    stubDocument({ visible: false, focused: false })
    vi.stubGlobal('navigator', {})
    expect(await notify('a', 'b')).toBe(false)
  })
})
