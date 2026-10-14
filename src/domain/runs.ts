import type { Entry, Pivot } from '../db'
import { flow, hoursPerPass, inchesFrom } from './pivot'

// Runs are rebuilt from entries every time, so a late OFF or a corrected flow flows through everything.

export interface Run {
  pivotId: string
  start: string | null // null = OFF with no ON
  stop: string | null // null = still running
  hours: number | null
  percentTimer: number | null
  direction: string | null
  plannedStop: string | null
  madeItAround: boolean | null
  gpm: number | null
  flowSource: string | null
  acres: number | null
  inches: number | null // gross, over the pivot's irrigated acres
  acreInches: number | null
  gallons: number | null
  who: string[]
  how: string[]
  entryIds: string[]
  issues: string[]
  periodHours: number | null // AgSense weekly total: hours run somewhere inside start..stop
  eta: string | null // running: when it should reach its stop point
}

export function liveEntries(entries: Entry[]): Entry[] {
  const voided = new Set(entries.filter((e) => e.action === 'void' && e.correctsId).map((e) => e.correctsId!))
  return entries.filter((e) => e.action !== 'void' && e.action !== 'note' && !voided.has(e.id))
}

const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3600000

export function buildRuns(entries: Entry[], pivot: Pivot, acres: number | null, now = new Date(), lapHours100: number | null = null): Run[] {
  const es = liveEntries(entries.filter((e) => e.pivotId === pivot.id)).sort((a, b) =>
    (a.action === 'run' ? a.startAt! : a.happenedAt).localeCompare(b.action === 'run' ? b.startAt! : b.happenedAt))
  const f = flow(pivot)
  const runs: Run[] = []
  let open: { on: Entry } | null = null

  const make = (start: string | null, stop: string | null, on: Entry | null, off: Entry | null, issues: string[]): Run => {
    const periodHours = on?.how === 'agsense' && on.hours != null ? on.hours : null
    const hours = periodHours ?? (start && stop ? hoursBetween(start, stop) : null)
    const iss = [...issues]
    if (!f) iss.push('No flow rate for this pivot')
    if (!acres) iss.push('No irrigated acres for this pivot')
    const pct = on?.percentTimer ?? null
    if (hours !== null && pct && !periodHours) {
      const pass = hoursPerPass(pivot, pct, lapHours100)
      if (pass && hours > pass * 1.5 + 6) iss.push(`Ran ${hours.toFixed(0)} h, longer than a pass (${pass.toFixed(0)} h)`)
    }
    const inches = hours !== null && f && acres ? inchesFrom(f.gpm, hours, acres) : null
    const ents = [on, off].filter(Boolean) as Entry[]
    return {
      pivotId: pivot.id, start, stop, hours, percentTimer: pct, direction: on?.direction ?? null, plannedStop: on?.plannedStop ?? null,
      madeItAround: off?.madeItAround ?? null, gpm: f?.gpm ?? null, flowSource: f?.source ?? null, acres,
      inches, acreInches: inches !== null && acres ? inches * acres : null, gallons: hours !== null && f ? f.gpm * hours * 60 : null,
      who: [...new Set(ents.map((e) => e.who))], how: [...new Set(ents.map((e) => e.how))], entryIds: [...new Set(ents.map((e) => e.id))], issues: iss,
      periodHours, eta: null,
    }
  }

  for (const e of es) {
    if (e.action === 'run') {
      runs.push(make(e.startAt!, e.stopAt!, { ...e }, { ...e }, []))
    } else if (e.action === 'on') {
      if (open) runs.push(make(open.on.happenedAt, null, open.on, null, ['Turned ON again with no OFF logged']))
      open = { on: e }
    } else if (e.action === 'off') {
      if (open) runs.push(make(open.on.happenedAt, e.happenedAt, open.on, e, []))
      else runs.push(make(null, e.happenedAt, null, e, ['OFF with no ON: when did it start?']))
      open = null
    }
  }
  if (open) {
    const r = make(open.on.happenedAt, null, open.on, null, [])
    const pass = open.on.percentTimer ? hoursPerPass(pivot, open.on.percentTimer, lapHours100) : null
    const h = hoursBetween(open.on.happenedAt, now.toISOString())
    if (h > (pass ? pass + 6 : 72)) r.issues.push('Still running? ON for ' + Math.round(h) + ' h')
    const toStop = stopHours(open.on, pass)
    if (toStop) r.eta = new Date(Date.parse(open.on.happenedAt) + toStop * 3600000).toISOString()
    runs.push(r)
  }
  return runs
}

/** Hours from the ON to its planned stop: a lap, or the degrees to the stop point. */
export function stopHours(on: Pick<Entry, 'plannedStop' | 'startDeg' | 'stopDeg' | 'direction'>, pass: number | null): number | null {
  if (!pass) return null
  if (on.plannedStop === 'lap') return pass
  if (on.plannedStop === 'position' && on.startDeg != null && on.stopDeg != null) {
    const deg = on.direction === 'reverse' ? (on.startDeg - on.stopDeg + 360) % 360 : (on.stopDeg - on.startDeg + 360) % 360
    return (pass * (deg || 360)) / 360
  }
  return null
}

/**
 * Hours per lap at 100%, learned from laps the crew marked "made it around" (one-lap stops only).
 * Used until the dealer chart value is on the pivot profile.
 */
export function learnLapHours(runs: Run[], arcDeg = 360): { hours: number; laps: number } | null {
  const xs = runs.filter((r) => r.madeItAround && r.plannedStop === 'lap' && r.percentTimer && r.hours && !r.periodHours)
    .map((r) => (r.hours! * r.percentTimer!) / 100 / (arcDeg / 360)).sort((a, b) => a - b)
  if (!xs.length) return null
  return { hours: xs[Math.floor(xs.length / 2)], laps: xs.length }
}

/** Farm time zone. Days in the water balance are farm days. */
export const FARM_TZ = 'America/New_York'
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: FARM_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
export const farmDay = (iso: string | number | Date) => dayFmt.format(new Date(iso))

/** Gross inches per farm day for a pivot, spreading each run over the hours it ran on each day. */
export function dailyApplied(runs: Run[], now = new Date()): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of runs) {
    if (!r.start || !r.gpm || !r.acres) continue
    const a = Date.parse(r.start), b = r.stop ? Date.parse(r.stop) : now.getTime()
    if (!(b > a)) continue
    // An AgSense weekly total is spread evenly over its week (the export has no run times).
    const share = r.periodHours != null ? r.periodHours / ((b - a) / 3600000) : 1
    const perHour = (r.gpm / (452.6 * r.acres)) * share
    const step = 15 * 60000
    for (let t = a; t < b; t += step) {
      const dt = Math.min(step, b - t) / 3600000
      const d = farmDay(t)
      out.set(d, (out.get(d) ?? 0) + perHour * dt)
    }
  }
  return out
}
