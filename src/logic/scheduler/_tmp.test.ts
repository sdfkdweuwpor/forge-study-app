import { it } from 'vitest'
import { planStudy } from './planner'
import { checkFeasibility } from './feasibility'
import { rollForward, replanWeek } from './reflow'
import { pinput, pcourse, rows, checkPlan, asCurrent } from './plannerFixtures'
const out = (x: unknown) => process.stdout.write(JSON.stringify(x) + '\n')

it('smoke', () => {
  const inp = pinput({
    courses: [pcourse('a', [300, 300], { order: 0 }), pcourse('b', [400], { order: 1 })],
    targetDate: '2026-10-23',
    settings: { bufferPct: 0.12 },
  })
  const res = planStudy(inp)
  out({ fits: res.fits, end: res.projectedEnd, buf: res.buffer, pace: res.pace, issues: res.issues })
  out(checkPlan(inp, res, ['a', 'b']))
  const f = checkFeasibility(inp)
  out(f)
  // roll forward: plan for Nov 20 target, then miss first 2 days
  const inp2 = { ...inp, targetDate: '2026-11-30' }
  const p2 = planStudy(inp2)
  out({ pace: p2.pace, end: p2.projectedEnd, buf: p2.buffer })
  out(rows(p2.items).slice(0, 8))
  const live = { ...inp2, today: '2026-10-08', current: asCurrent(p2.items), paceMinutesPerStudyDay: p2.pace.minutesPerStudyDay, baselineEnd: p2.projectedEnd }
  const rf = rollForward(live)
  out({ status: rf.status, auto: rf.autoApply, moved: rf.change.moved.length, end: rf.projectedEnd })
  out(rf.change.moved.slice(0, 5))
  const wk = replanWeek(live, { weekStart: '2026-10-05', today: '2026-10-08' })
  out({ status: wk.status, moved: wk.change.moved.length, end: wk.projectedEnd })
  // missed a whole week+ → far behind
  const live3 = { ...live, today: '2026-10-26' }
  const rf3 = rollForward(live3)
  out({ status: rf3.status, auto: rf3.autoApply, props: rf3.proposals.map(p => [p.kind, p.title, p.fits, p.projectedEnd, p.apply]) })
})
