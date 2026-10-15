import type { FarmState, FieldView, PivotView } from './farm'

// The crop filter at the top of the app (All / Cotton / Peanuts / Corn). It narrows what every main
// screen shows; it never changes the records. Pivot and field pages always use the whole farm.

export const CROP_FILTERS = ['All', 'Cotton', 'Peanuts', 'Corn'] as const
export type CropFilter = (typeof CROP_FILTERS)[number]

/** The farm narrowed to one crop: its fields, the pivots that water them, and those pivots' entries. */
export function filterState(state: FarmState, crop: CropFilter): FarmState {
  if (crop === 'All') return state
  const fields = state.fields.filter((f) => f.season?.crop === crop)
  const ids = new Set(fields.map((f) => f.pivot?.id).filter(Boolean) as string[])
  return { ...state, fields, pivots: state.pivots.filter((p) => ids.has(p.pivot.id)), entries: state.entries.filter((e) => ids.has(e.pivotId)) }
}

export type PivotStatus = 'run' | 'now' | 'soon' | 'ok' | 'none'
const RANK: Record<string, number> = { now: 0, soon: 1, ok: 2, off: 3, none: 4 }
export const STATUS_ORDER: Record<PivotStatus, number> = { run: 0, now: 1, soon: 2, ok: 3, none: 4 }

/** A pivot's state on Today: running, or the most urgent of the fields it waters. */
export function pivotStatus(p: PivotView, fields: FieldView[]): { status: PivotStatus; field: FieldView | null; crop: string | null } {
  const mine = fields.filter((f) => f.pivot?.id === p.pivot.id)
  const worst = [...mine].sort((a, b) => RANK[a.advice.status] - RANK[b.advice.status] || b.advice.pctDry - a.advice.pctDry)[0] ?? null
  const crop = worst?.season?.crop ?? mine.find((f) => f.season)?.season?.crop ?? null
  if (p.running) return { status: 'run', field: worst, crop }
  const s = worst?.advice.status
  return { status: s === 'now' || s === 'soon' || s === 'ok' ? s : 'none', field: worst, crop }
}

/** Soil water left, as % full, averaged over the modeled fields by acres. Null when nothing is modeled. */
export function soilFull(fields: FieldView[]): number | null {
  let w = 0, s = 0
  for (const f of fields) {
    if (f.advice.status === 'none' || !f.days.length) continue
    const ac = f.season?.acres || 1
    w += ac; s += ac * (100 - f.advice.pctDry)
  }
  return w ? Math.round(s / w) : null
}

/** Last day's radar rain: the most any pivot got, and the farms where it rained at least 0.10 in. */
export function lastNightRain(fields: FieldView[]): { inches: number; farms: string[]; date: string | null } {
  let inches = 0, date: string | null = null
  const farms = new Set<string>()
  for (const f of fields) {
    const d = f.days.at(-1)
    if (!d) continue
    if (!date || d.date > date) date = d.date
    inches = Math.max(inches, d.rain)
    if (d.rain >= 0.1 && f.farm) farms.add(f.farm.name)
  }
  return { inches, farms: [...farms].sort(), date }
}

/** Crop water use on the last modeled day, averaged over the fields by acres (in/day). */
export function cropUseToday(fields: FieldView[]): number | null {
  let w = 0, s = 0
  for (const f of fields) {
    const d = f.days.at(-1)
    if (!d || f.advice.status === 'none') continue
    const ac = f.season?.acres || 1
    w += ac; s += ac * d.etc
  }
  return w ? s / w : null
}
