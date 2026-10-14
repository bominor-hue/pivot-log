import { describe, expect, it } from 'vitest'
import type { Entry, Pivot } from '../db'
import { buildRuns, dailyApplied } from './runs'
import { hoursPerPass, setProfile } from './pivot'

const at = '2026-01-01T00:00:00Z'
const pivot = (): Pivot => {
  const p: Pivot = { id: 'p1', farmId: 'f', name: 'Hodges 4', profile: {} }
  setProfile(p, 'flowGpm', 900, 'pivot info sheet', at)
  setProfile(p, 'hoursPerRev100', 18, 'pivot info sheet', at)
  return p
}
let n = 0
const e = (action: Entry['action'], happenedAt: string, extra: Partial<Entry> = {}): Entry =>
  ({ id: 'e' + ++n, pivotId: 'p1', action, happenedAt, recordedAt: happenedAt, who: 'Bo', how: 'app', synced: 0, ...extra })

describe('runs from entries', () => {
  it('pairs ON and OFF and works out inches', () => {
    const runs = buildRuns([e('on', '2026-07-01T10:00:00-04:00', { percentTimer: 50 }), e('off', '2026-07-02T22:00:00-04:00', { madeItAround: true })], pivot(), 150)
    expect(runs).toHaveLength(1)
    expect(runs[0].hours).toBe(36)
    expect(runs[0].inches).toBeCloseTo((900 * 36) / (452.6 * 150))
    expect(runs[0].madeItAround).toBe(true)
    expect(runs[0].issues).toEqual([])
  })
  it('flags an OFF with no ON and a second ON', () => {
    const runs = buildRuns([e('off', '2026-07-01T10:00:00Z'), e('on', '2026-07-02T10:00:00Z'), e('on', '2026-07-03T10:00:00Z'), e('off', '2026-07-03T20:00:00Z')], pivot(), 150, new Date('2026-07-04T00:00:00Z'))
    expect(runs.map((r) => r.issues[0] ?? '')).toEqual(['OFF with no ON: when did it start?', 'Turned ON again with no OFF logged', ''])
  })
  it('a void entry cancels the entry it corrects', () => {
    const on = e('on', '2026-07-01T10:00:00Z')
    const runs = buildRuns([on, e('void', '2026-07-01T10:05:00Z', { correctsId: on.id })], pivot(), 150)
    expect(runs).toHaveLength(0)
  })
  it('flags a pivot left on far longer than a pass', () => {
    const runs = buildRuns([e('on', '2026-07-01T00:00:00Z', { percentTimer: 100 })], pivot(), 150, new Date('2026-07-03T00:00:00Z'))
    expect(runs[0].stop).toBeNull()
    expect(runs[0].issues.join()).toMatch(/Still running/)
  })
  it('spreads a run over farm days', () => {
    const runs = buildRuns([e('run', '2026-07-02T04:00:00Z', { startAt: '2026-07-01T22:00:00-04:00', stopAt: '2026-07-02T04:00:00-04:00' })], pivot(), 150)
    const d = dailyApplied(runs)
    const perHour = 900 / (452.6 * 150)
    expect(d.get('2026-07-01')).toBeCloseTo(2 * perHour)
    expect(d.get('2026-07-02')).toBeCloseTo(4 * perHour)
  })
})

describe('pivot profile', () => {
  it('a measured value is not replaced by a lower-ranked one, and blanks never erase', () => {
    const p = pivot()
    expect(setProfile(p, 'flowGpm', 950, 'measured', at)).toBe(true)
    expect(setProfile(p, 'flowGpm', 800, 'AgSense setting', at)).toBe(false)
    expect(setProfile(p, 'flowGpm', '', 'measured', at)).toBe(false)
    expect(p.profile.flowGpm.value).toBe(950)
  })
  it('percent timer and part circles set pass time', () => {
    const p = pivot()
    expect(hoursPerPass(p, 50)).toBe(36)
    setProfile(p, 'arcDeg', 180, 'pivot info sheet', at)
    expect(hoursPerPass(p, 50)).toBe(18)
  })
})

describe('lap time', () => {
  it('is learned from one-lap runs that made it around', async () => {
    const { learnLapHours } = await import('./runs')
    const p = pivot(); delete p.profile.hoursPerRev100
    const runs = buildRuns([
      e('on', '2026-07-01T00:00:00Z', { percentTimer: 50, plannedStop: 'lap' }), e('off', '2026-07-02T12:00:00Z', { madeItAround: true }),
      e('on', '2026-07-03T00:00:00Z', { percentTimer: 50, plannedStop: 'lap' }), e('off', '2026-07-03T10:00:00Z', { madeItAround: false }),
    ], p, 150)
    expect(learnLapHours(runs)).toEqual({ hours: 18, laps: 1 }) // 36 h at 50% = 18 h at 100%
    const running = buildRuns([e('on', '2026-07-05T00:00:00Z', { percentTimer: 50, plannedStop: 'lap' })], p, 150, new Date('2026-07-05T01:00:00Z'), 18)
    expect(running[0].eta).toBe('2026-07-06T12:00:00.000Z')
  })
  it('spreads an AgSense week evenly', () => {
    const runs = buildRuns([e('run', '2026-07-08T03:59:59Z', { how: 'agsense', hours: 14, startAt: '2026-07-01T04:00:00Z', stopAt: '2026-07-08T03:59:59Z' })], pivot(), 150)
    expect(runs[0].hours).toBe(14)
    const d = dailyApplied(runs)
    const perHour = 900 / (452.6 * 150)
    expect([...d.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(14 * perHour, 3)
    expect(d.get('2026-07-03')).toBeCloseTo(2 * perHour, 3)
  })
})
