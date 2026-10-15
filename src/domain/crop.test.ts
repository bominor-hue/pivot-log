import { describe, expect, it } from 'vitest'
import { filterState, lastNightRain, pivotStatus, soilFull } from './crop'

const day = (rain: number, etc = 0.2) => ({ date: '2026-07-16', rain, etc }) as any
const field = (id: string, pivotId: string, crop: string, status: string, pctDry: number, acres = 100, rain = 0, farm = 'A&B Farm') =>
  ({ field: { id }, pivot: { id: pivotId }, season: { crop, acres }, farm: { name: farm }, days: [day(rain)], advice: { status, pctDry, line: '' } }) as any
const pivot = (id: string, running = false) => ({ pivot: { id, name: id }, running: running ? { start: '2026-07-16T06:00' } : null, runs: [] }) as any

const state = {
  fields: [field('f1', 'p1', 'Corn', 'ok', 30), field('f2', 'p2', 'Peanuts', 'now', 80, 50, 0.8, 'Hodges'), field('f3', 'p2', 'Peanuts', 'soon', 60)],
  pivots: [pivot('p1'), pivot('p2', true)],
  entries: [{ pivotId: 'p1' }, { pivotId: 'p2' }],
} as any

describe('crop filter', () => {
  it('keeps one crop, the pivots that water it, and their entries', () => {
    const s = filterState(state, 'Peanuts')
    expect(s.fields.map((f) => f.field.id)).toEqual(['f2', 'f3'])
    expect(s.pivots.map((p) => p.pivot.id)).toEqual(['p2'])
    expect(s.entries).toEqual([{ pivotId: 'p2' }])
    expect(filterState(state, 'All')).toBe(state)
  })

  it('a pivot shows running first, else its most urgent field', () => {
    expect(pivotStatus(state.pivots[1], state.fields).status).toBe('run')
    expect(pivotStatus({ ...state.pivots[1], running: null }, state.fields)).toMatchObject({ status: 'now', crop: 'Peanuts' })
    expect(pivotStatus(state.pivots[0], state.fields).status).toBe('ok')
  })

  it('averages soil water by acres and finds last night\'s rain', () => {
    expect(soilFull(state.fields)).toBe(Math.round((70 * 100 + 20 * 50 + 40 * 100) / 250))
    expect(lastNightRain(state.fields)).toEqual({ inches: 0.8, farms: ['Hodges'], date: '2026-07-16' })
  })
})
