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
}

export function liveEntries(entries: Entry[]): Entry[] {
  const voided = new Set(entries.filter((e) => e.action === 'void' && e.correctsId).map((e) => e.correctsId!))
  return entries.filter((e) => e.action !== 'void' && e.action !== 'note' && !voided.has(e.id))
}

const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3600000

export function buildRuns(entries: Entry[], pivot: Pivot, acres: number | null, now = new Date()): Run[] {
  const es = liveEntries(entries.filter((e) => e.pivotId === pivot.id)).sort((a, b) =>
    (a.action === 'run' ? a.startAt! : a.happenedAt).localeCompare(b.action === 'run' ? b.startAt! : b.happenedAt))
  const f = flow(pivot)
  const runs: Run[] = []
  let open: { on: Entry } | null = null

  const make = (start: string | null, stop: string | null, on: Entry | null, off: Entry | null, issues: string[]): Run => {
    const hours = start && stop ? hoursBetween(start, stop) : null
    const iss = [...issues]
    if (!f) iss.push('No flow rate for this pivot')
    if (!acres) iss.push('No irrigated acres for this pivot')
    const pct = on?.percentTimer ?? null
    if (hours !== null && pct) {
      const pass = hoursPerPass(pivot, pct)
      if (pass && hours > pass * 1.5 + 6) iss.push(`Ran ${hours.toFixed(0)} h, longer than a pass (${pass.toFixed(0)} h)`)
    }
    const inches = hours !== null && f && acres ? inchesFrom(f.gpm, hours, acres) : null
    const ents = [on, off].filter(Boolean) as Entry[]
    return {
      pivotId: pivot.id, start, stop, hours, percentTimer: pct, direction: on?.direction ?? null, plannedStop: on?.plannedStop ?? null,
      madeItAround: off?.madeItAround ?? null, gpm: f?.gpm ?? null, flowSource: f?.source ?? null, acres,
      inches, acreInches: inches !== null && acres ? inches * acres : null, gallons: hours !== null && f ? f.gpm * hours * 60 : null,
      who: [...new Set(ents.map((e) => e.who))], how: [...new Set(ents.map((e) => e.how))], entryIds: ents.map((e) => e.id), issues: iss,
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
    const pass = open.on.percentTimer ? hoursPerPass(pivot, open.on.percentTimer) : null
    const h = hoursBetween(open.on.happenedAt, now.toISOString())
    if (h > (pass ? pass + 6 : 72)) r.issues.push('Still running? ON for ' + Math.round(h) + ' h')
    runs.push(r)
  }
  return runs
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
    const perHour = r.gpm / (452.6 * r.acres)
    const step = 15 * 60000
    for (let t = a; t < b; t += step) {
      const dt = Math.min(step, b - t) / 3600000
      const d = farmDay(t)
      out.set(d, (out.get(d) ?? 0) + perHour * dt)
    }
  }
  return out
}
