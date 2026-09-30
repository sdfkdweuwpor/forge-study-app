/**
 * blocked.html: the page a blocked navigation is redirected to (`blocked.html?site=<domain>#<original url>`).
 * It only READS storage. Logging an attempt and granting an unlock are messages to the service
 * worker, which is the one place that writes (see background/sw.ts).
 */
import { byId } from '../lib/dom.js'
import { loadState } from '../lib/store.js'
import { normalizeDomain, resolveReturnUrl } from '../shared/domains.js'
import type { InternalMessage, InternalResponse } from '../shared/internal.js'
import { activeSession } from '../shared/state.js'
import { formatClock, secondsLeft } from '../shared/time.js'
import {
  isUnlockPhrase,
  pickMotivation,
  UNLOCK_PHRASE,
  UNLOCK_WAIT_SECONDS,
  waitSecondsLeft,
} from '../shared/unlock.js'
import { shouldLogAttempt } from './attempt.js'

const params = new URLSearchParams(window.location.search)
/** `site` comes from the URL, which anyone can write: it is normalized and only ever set as text. */
const site = normalizeDomain(params.get('site') ?? '')
/** The original URL is in the fragment so `&` and `#` in it survive; resolveReturnUrl vets it before use. */
const originalUrl = window.location.hash.slice(1)
const isTopFrame = window.top === window

const main = byId('main', HTMLElement)
const views = {
  blocked: byId('view-blocked', HTMLElement),
  wait: byId('view-wait', HTMLElement),
  phrase: byId('view-phrase', HTMLElement),
}
const focusTargets: Record<keyof typeof views, HTMLElement> = {
  blocked: byId('btn-back', HTMLButtonElement),
  wait: byId('wait-title', HTMLElement),
  phrase: byId('phrase-input', HTMLInputElement),
}
const siteTitle = byId('site-title', HTMLElement)
const sessionBox = byId('session', HTMLElement)
const clock = byId('clock', HTMLElement)
const clockLabel = byId('clock-label', HTMLElement)
const taskLine = byId('task', HTMLElement)
const taskTitle = byId('task-title', HTMLElement)
const motivation = byId('motivation', HTMLElement)
const notice = byId('notice', HTMLElement)
const backButton = byId('btn-back', HTMLButtonElement)
const accessButton = byId('btn-access', HTMLButtonElement)
const waitCount = byId('wait-count', HTMLElement)
const waitLive = byId('wait-live', HTMLElement)
const phraseSite = byId('phrase-site', HTMLElement)
const phraseText = byId('phrase-text', HTMLElement)
const phraseForm = byId('phrase-form', HTMLFormElement)
const phraseInput = byId('phrase-input', HTMLInputElement)
const phraseError = byId('phrase-error', HTMLElement)

let clockTimer: number | undefined
let waitTimer: number | undefined

function stopClock(): void {
  if (clockTimer !== undefined) window.clearInterval(clockTimer)
  clockTimer = undefined
}

function stopWait(): void {
  if (waitTimer !== undefined) window.clearInterval(waitTimer)
  waitTimer = undefined
}

window.addEventListener('pagehide', () => {
  stopClock()
  stopWait()
})

function show(view: keyof typeof views, moveFocus: boolean): void {
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view
  if (moveFocus) focusTargets[view].focus()
}

function setNotice(message: string, tone: 'info' | 'error'): void {
  notice.textContent = message
  notice.dataset['tone'] = tone
  notice.hidden = false
}

async function sendToWorker(message: InternalMessage): Promise<InternalResponse> {
  try {
    const response: unknown = await chrome.runtime.sendMessage(message)
    const ok = typeof response === 'object' && response !== null && 'ok' in response && response.ok === true
    return ok ? { ok: true } : { ok: false, error: 'The extension did not accept that.' }
  } catch {
    return { ok: false, error: 'Could not reach the extension. Reload this page and try again.' }
  }
}

async function goBackToWork(): Promise<void> {
  if (window.history.length > 1) {
    window.history.back()
    return
  }
  const tab = await chrome.tabs.getCurrent()
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id)
  else window.close()
}

// Session countdown, computed from `endsAt` on every tick (never decremented).
function startClock(endsAt: number): void {
  const render = (): void => {
    const left = secondsLeft(endsAt, Date.now())
    clock.textContent = formatClock(left)
    if (left === 0) {
      clockLabel.textContent = 'This focus session has finished'
      stopClock()
    }
  }
  sessionBox.hidden = false
  render()
  stopClock()
  clockTimer = window.setInterval(render, 1000)
}

// Emergency unlock, step 1: 60 seconds, from a deadline timestamp.
function startWait(): void {
  stopWait()
  const deadline = Date.now() + UNLOCK_WAIT_SECONDS * 1000
  let announced = -1
  show('wait', true)
  const tick = (): void => {
    const left = waitSecondsLeft(deadline, Date.now())
    waitCount.textContent = String(left)
    // The number changes every second; the live region is only updated every 10 seconds so it is not chatty.
    if (left % 10 === 0 && left !== announced) {
      announced = left
      waitLive.textContent = left > 0 ? `${left} seconds left` : 'You can continue now.'
    }
    if (left === 0) {
      stopWait()
      show('phrase', true)
    }
  }
  tick()
  waitTimer = window.setInterval(tick, 250)
}

function cancelUnlock(): void {
  stopWait()
  phraseInput.value = ''
  phraseError.hidden = true
  show('blocked', true)
}

// Emergency unlock, step 2: the phrase.
let unlocking = false

async function unlock(): Promise<void> {
  if (unlocking || site === null) return
  unlocking = true
  phraseInput.disabled = true
  const result = await sendToWorker({ type: 'internal:unlock', domain: site })
  if (!result.ok) {
    unlocking = false
    phraseInput.disabled = false
    phraseError.textContent = result.error
    phraseError.hidden = false
    phraseInput.focus()
    return
  }
  phraseError.textContent = ''
  phraseError.hidden = true
  waitLive.textContent = `Unlocked for 5 minutes. Taking you to ${site}.`
  // replace(): the blocked page does not stay in the history, so Back does not land on it again.
  window.location.replace(resolveReturnUrl(originalUrl, site))
}

phraseInput.addEventListener('input', () => {
  phraseError.hidden = true
  if (isUnlockPhrase(phraseInput.value)) void unlock()
})

phraseForm.addEventListener('submit', (event) => {
  event.preventDefault()
  if (isUnlockPhrase(phraseInput.value)) {
    void unlock()
  } else {
    phraseError.textContent = 'That does not match yet. Type the phrase exactly as shown.'
    phraseError.hidden = false
  }
})

backButton.addEventListener('click', () => void goBackToWork())
byId('btn-wait-cancel', HTMLButtonElement).addEventListener('click', () => void goBackToWork())
byId('btn-phrase-cancel', HTMLButtonElement).addEventListener('click', () => void goBackToWork())
accessButton.addEventListener('click', startWait)

// Escape leaves the unlock flow without doing anything.
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && views.blocked.hidden) cancelUnlock()
})

async function init(): Promise<void> {
  phraseText.textContent = UNLOCK_PHRASE
  if (site !== null) {
    siteTitle.textContent = `${site} is blocked`
    phraseSite.textContent = site
    document.title = `${site} is blocked · Forge Focus`
  }

  if (!isTopFrame || site === null) {
    // Framed by another page, or opened with no usable site: nothing to log or unlock.
    accessButton.hidden = true
    main.setAttribute('aria-busy', 'false')
    return
  }

  const navigation = performance.getEntriesByType('navigation')[0]
  const navigationType = navigation instanceof PerformanceNavigationTiming ? navigation.type : ''
  if (shouldLogAttempt({ isTopFrame, referrer: document.referrer, navigationType })) {
    void sendToWorker({ type: 'internal:blocked', domain: site })
  }

  try {
    const state = await loadState()
    const session = activeSession(state, Date.now())
    if (session?.taskTitle) {
      taskTitle.textContent = session.taskTitle
      taskLine.hidden = false
    }
    if (session?.endsAt) startClock(session.endsAt)
    const line = pickMotivation(state.config.motivation)
    if (line !== null) {
      motivation.textContent = line
      motivation.hidden = false
    }
  } catch {
    setNotice('Could not load your focus session. Blocking still works.', 'error')
  } finally {
    main.setAttribute('aria-busy', 'false')
  }
}

void init()
