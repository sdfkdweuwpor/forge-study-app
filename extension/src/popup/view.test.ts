import { describe, expect, it } from 'vitest'
import { defaultState, type ExtensionState } from '../shared/state.js'
import { popupModel, winsLabel } from './view.js'

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo, d, h, mi).getTime()
const NOW = local(2026, 8, 29, 21, 0) // Tue Sep 29 2026, 9pm: already Sep 30 in UTC

function state(patch: Partial<ExtensionState> = {}, mode: ExtensionState['config']['mode'] = 'always'): ExtensionState {
  const base = defaultState()
  return { ...base, config: { ...base.config, mode }, ...patch }
}

describe('winsLabel', () => {
  it('pluralises', () => {
    expect(winsLabel(0)).toBe('0 wins today')
    expect(winsLabel(1)).toBe('1 win today')
    expect(winsLabel(7)).toBe('7 wins today')
  })
})

describe('popupModel', () => {
  it("counts today's wins on the LOCAL day, so 9pm New York still shows today's count", () => {
    const s = state({ dailyAttempts: { date: '2026-09-29', count: 7 } })
    expect(popupModel(s, NOW).wins).toBe('7 wins today')
  })

  it('shows 0 once the stored day is not today', () => {
    const s = state({ dailyAttempts: { date: '2026-09-28', count: 7 } })
    expect(popupModel(s, NOW).wins).toBe('0 wins today')
  })

  it('reports a running focus session with its task and end', () => {
    const s = state({ session: { active: true, endsAt: NOW + 90_000, taskTitle: 'C182 Unit 3 practice' } }, 'focus')
    expect(popupModel(s, NOW)).toMatchObject({
      focusRunning: true,
      endsAt: NOW + 90_000,
      taskTitle: 'C182 Unit 3 practice',
      mode: 'During focus sessions',
      blocking: 'Blocking now',
    })
  })

  it('treats a session past its end as not running', () => {
    const s = state({ session: { active: true, endsAt: NOW - 1, taskTitle: 'C779 Web Development' } }, 'focus')
    expect(popupModel(s, NOW)).toMatchObject({ focusRunning: false, endsAt: null, taskTitle: null })
  })

  it('explains why blocking is off in focus and schedule modes', () => {
    expect(popupModel(state({}, 'focus'), NOW).blocking).toBe('Starts with your next focus session')
    const scheduled = state({}, 'schedule')
    expect(popupModel(scheduled, NOW).blocking).toBe('Off outside your scheduled times')
    expect(popupModel(scheduled, NOW).mode).toBe('On a schedule')
  })

  it('always mode is blocking regardless of a session', () => {
    expect(popupModel(state(), NOW)).toMatchObject({ mode: 'Always on', blocking: 'Blocking now', focusRunning: false })
  })
})
