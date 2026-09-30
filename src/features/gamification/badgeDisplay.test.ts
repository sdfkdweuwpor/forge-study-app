import { describe, expect, it } from 'vitest'
import { displayContext } from './badgeDisplay'

describe('displayContext', () => {
  it('writes 24-hour times the way the rest of the app does', () => {
    expect(displayContext('Started at 07:30')).toBe('Started at 7:30 AM')
    expect(displayContext('Started at 22:05')).toBe('Started at 10:05 PM')
    expect(displayContext('Started at 00:00')).toBe('Started at 12 AM')
  })

  it('leaves everything else alone', () => {
    expect(displayContext('4 sessions on Tue, Sep 29')).toBe('4 sessions on Tue, Sep 29')
    expect(displayContext('C182')).toBe('C182')
    expect(displayContext('Ratio 12:345 and 24:00')).toBe('Ratio 12:345 and 24:00')
  })
})
