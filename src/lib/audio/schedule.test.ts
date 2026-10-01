import { describe, expect, it } from 'vitest'
import { createRng } from './noise'
import {
  birdPhrase,
  CHIME_PARTIALS,
  chimeLength,
  chimeSchedule,
  clinkEvent,
  crackleEvent,
  dropletEvent,
  nextEventTime,
  partialEnvelope,
  thunderEvent,
  waveSwell,
} from './schedule'

describe('chimeSchedule', () => {
  it('is a short rising phrase of two to three notes', () => {
    const notes = chimeSchedule(0.6)
    expect(notes.length).toBeGreaterThanOrEqual(2)
    expect(notes.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i]?.freq).toBeGreaterThan(notes[i - 1]?.freq ?? Infinity)
      expect(notes[i]?.start).toBeGreaterThan(notes[i - 1]?.start ?? Infinity)
    }
  })

  it('lasts about a second and a fifth', () => {
    const length = chimeLength(chimeSchedule(0.6))
    expect(length).toBeGreaterThan(1.0)
    expect(length).toBeLessThan(1.35)
  })

  it('keeps every partial audible but not shrill', () => {
    for (const note of chimeSchedule(1)) {
      for (const p of CHIME_PARTIALS) {
        expect(note.freq * p.ratio).toBeGreaterThan(200)
        expect(note.freq * p.ratio).toBeLessThan(5000)
      }
    }
  })

  it('scales with volume and is empty when muted', () => {
    const quiet = chimeSchedule(0.3)[0]?.gain ?? 0
    const loud = chimeSchedule(0.9)[0]?.gain ?? 0
    expect(loud).toBeGreaterThan(quiet)
    expect(chimeSchedule(0)).toEqual([])
    expect(chimeSchedule(Number.NaN)).toEqual([])
  })

  it('stays well below full scale even at full volume with all partials stacked', () => {
    const note = chimeSchedule(1)[0]
    const stacked = CHIME_PARTIALS.reduce((sum, p) => sum + p.gain, 0) * (note?.gain ?? 0)
    expect(stacked).toBeLessThan(0.5)
  })
})

describe('partialEnvelope', () => {
  it('lets the overtones die faster than the fundamental', () => {
    const note = chimeSchedule(0.6)[0]
    if (!note) throw new Error('no note')
    const [fundamental, second, third] = CHIME_PARTIALS.map((p) => partialEnvelope(note, p))
    expect(second?.tau).toBeLessThan(fundamental?.tau ?? 0)
    expect(third?.tau).toBeLessThan(second?.tau ?? 0)
    expect(fundamental?.duration).toBe(note.duration)
  })
})

describe('nextEventTime', () => {
  it('is deterministic per seed and always later than `after`', () => {
    const a = createRng(3)
    const b = createRng(3)
    for (let i = 0; i < 50; i++) {
      const t = nextEventTime(a, 10, 4)
      expect(t).toBe(nextEventTime(b, 10, 4))
      expect(t).toBeGreaterThan(10)
    }
  })

  it('averages one event per 1/rate seconds', () => {
    const rng = createRng(99)
    let t = 0
    const n = 5000
    for (let i = 0; i < n; i++) t = nextEventTime(rng, t, 4)
    expect(t / n).toBeGreaterThan(0.25 * 0.9)
    expect(t / n).toBeLessThan(0.25 * 1.1)
  })

  it('never puts two events closer than the minimum gap', () => {
    const rng = createRng(5)
    let t = 0
    for (let i = 0; i < 500; i++) {
      const next = nextEventTime(rng, t, 50, 0.4)
      expect(next - t).toBeGreaterThanOrEqual(0.4 - 1e-9)
      t = next
    }
  })

  it('copes with a zero rate without returning NaN or a past time', () => {
    const t = nextEventTime(createRng(1), 5, 0)
    expect(Number.isFinite(t)).toBe(true)
    expect(t).toBeGreaterThan(5)
  })
})

describe('event shapes', () => {
  it('rain drops are tiny, high and brief', () => {
    const rng = createRng(8)
    for (let i = 0; i < 500; i++) {
      const d = dropletEvent(rng)
      expect(d.freq).toBeGreaterThanOrEqual(1800)
      expect(d.freq).toBeLessThanOrEqual(5200)
      expect(d.gain).toBeGreaterThan(0)
      expect(d.gain).toBeLessThan(0.08)
      expect(d.decay).toBeLessThan(0.06)
    }
  })

  it('café clinks are soft and ring for a fraction of a second', () => {
    const rng = createRng(8)
    for (let i = 0; i < 500; i++) {
      const c = clinkEvent(rng)
      expect(c.freq).toBeGreaterThanOrEqual(2300)
      expect(c.freq).toBeLessThanOrEqual(4200)
      expect(c.gain).toBeLessThan(0.04)
      expect(c.decay).toBeGreaterThan(0.1)
      expect(c.decay).toBeLessThan(0.4)
    }
  })
})

describe('noise-layer events', () => {
  const draws = <T>(fn: (r: () => number) => T) => {
    const r = createRng(11)
    return Array.from({ length: 1000 }, () => fn(r))
  }
  const within = (v: number, lo: number, hi: number) => {
    expect(v).toBeGreaterThanOrEqual(lo)
    expect(v).toBeLessThanOrEqual(hi)
  }

  it('crackleEvent stays in range', () => {
    for (const c of draws(crackleEvent)) {
      within(c.gain, 0.05, 0.6)
      within(c.freq, 800, 4000)
      within(c.decay, 0.005, 0.06)
    }
  })

  it('birdPhrase has 2-6 ascending chirps within 1.5 s at 1.8-5 kHz', () => {
    for (const p of draws(birdPhrase)) {
      expect(p.notes.length).toBeGreaterThanOrEqual(2)
      expect(p.notes.length).toBeLessThanOrEqual(6)
      p.notes.forEach((n, i) => {
        within(n.freq, 1800, 5000)
        within(n.dur, 0.04, 0.25)
        expect(n.at + n.dur).toBeLessThanOrEqual(1.5)
        if (i === 0) expect(n.at).toBe(0)
        else expect(n.at).toBeGreaterThan(p.notes[i - 1]?.at ?? Infinity)
      })
    }
  })

  it('thunderEvent and waveSwell stay in range', () => {
    for (const t of draws(thunderEvent)) {
      within(t.gain, 0.3, 1)
      within(t.rumbleSeconds, 4, 9)
    }
    for (const w of draws(waveSwell)) {
      within(w.period, 6, 11)
      within(w.peak, 0.4, 1)
    }
  })

  it('is deterministic for a seed', () => {
    for (const fn of [crackleEvent, birdPhrase, thunderEvent, waveSwell]) {
      expect(fn(createRng(9))).toEqual(fn(createRng(9)))
    }
  })
})
