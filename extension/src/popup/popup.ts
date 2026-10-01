/** Toolbar popup: read-only status, plus a button that opens the app. Nothing here writes storage. */
import { byId } from '../lib/dom.js'
import { loadState } from '../lib/store.js'
import { APP_URL } from '../shared/config.js'
import { formatClock, secondsLeft } from '../shared/time.js'
import { popupModel } from './view.js'

const popup = byId('popup', HTMLElement)
const loading = byId('state-loading', HTMLElement)
const errorBox = byId('state-error', HTMLElement)
const ready = byId('state-ready', HTMLElement)
const wins = byId('wins', HTMLElement)
const focus = byId('focus', HTMLElement)
const rowClock = byId('row-clock', HTMLElement)
const clock = byId('clock', HTMLElement)
const rowTask = byId('row-task', HTMLElement)
const task = byId('task', HTMLElement)
const mode = byId('mode', HTMLElement)
const blocking = byId('blocking', HTMLElement)

let clockTimer: number | undefined

function stopClock(): void {
  if (clockTimer !== undefined) window.clearInterval(clockTimer)
  clockTimer = undefined
}

window.addEventListener('pagehide', stopClock)

byId('btn-open-app', HTMLButtonElement).addEventListener('click', () => {
  void chrome.tabs.create({ url: APP_URL })
})

/** Counts down from `endsAt` on every tick, so a slow tick can never drift the display. */
function startClock(endsAt: number): void {
  const render = (): void => {
    const left = secondsLeft(endsAt, Date.now())
    clock.textContent = formatClock(left)
    if (left === 0) stopClock()
  }
  render()
  stopClock()
  clockTimer = window.setInterval(render, 1000)
}

async function init(): Promise<void> {
  try {
    const model = popupModel(await loadState(), Date.now())
    wins.textContent = model.wins
    focus.textContent = model.focusRunning ? 'Running' : 'Not running'
    mode.textContent = model.mode
    blocking.textContent = model.blocking

    rowTask.hidden = model.taskTitle === null
    task.textContent = model.taskTitle ?? ''

    rowClock.hidden = model.endsAt === null
    if (model.endsAt !== null) startClock(model.endsAt)

    ready.hidden = false
  } catch {
    errorBox.hidden = false
  } finally {
    loading.hidden = true
    popup.setAttribute('aria-busy', 'false')
  }
}

void init()
