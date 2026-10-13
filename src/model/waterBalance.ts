// Daily soil water balance for one field, ported from model/water_balance.py (2026 season model).
//
//   depletion today = depletion yesterday + crop ET - effective rain - net irrigation
//
// bounded by 0 (field capacity, anything extra drains) and TAW (wilting point).
// Settings match the Python model so the app and the 2026 report agree.

export type Crop = 'Corn' | 'Cotton' | 'Peanuts'

export const SETTINGS = {
  // last day (DAP) the model recommends irrigation: corn ~black layer, cotton ~60% open boll, peanut ~2 wk before digging
  stopDap: { Corn: 110, Cotton: 130, Peanuts: 135 } as Record<Crop, number>,
  // FAO-56 Table 12, Kc ini / mid / end, stage days ini, dev, mid, late
  kc: {
    Corn: [0.3, 1.15, 0.475, [20, 35, 40, 30]],
    Cotton: [0.35, 1.13, 0.6, [30, 50, 55, 45]],
    Peanuts: [0.4, 1.12, 0.6, [30, 40, 50, 30]],
  } as Record<Crop, [number, number, number, [number, number, number, number]]>,
  rootMaxIn: { Corn: 24, Cotton: 24, Peanuts: 18 } as Record<Crop, number>,
  rootStartIn: 6,
  rootGrowthInPerDay: 0.3,
  trigger: 0.5,
  cornPeakTrigger: [50, 95, 0.45] as [number, number, number], // corn tighter at peak
  maxNetIn: { Corn: 1.0, Cotton: 1.0, Peanuts: 0.75 } as Record<Crop, number>,
  efficiency: 0.85,
  minRainIn: 0.1,
}

export const CROPS: Crop[] = ['Corn', 'Cotton', 'Peanuts']
export const isCrop = (c: string): c is Crop => (CROPS as string[]).includes(c)

export interface Soil { aws50: number; aws100: number } // SSURGO available water storage, 0-50 cm and 0-100 cm (in)

export interface BalanceInput {
  crop: Crop
  plantDate: string // YYYY-MM-DD
  soil: Soil
  dates: string[] // consecutive days
  eto: number[] // in/day
  rain: number[] // in/day at the field
  appliedGross?: number[] // in/day applied by the pivot (gross). Net = gross x efficiency.
}

export interface BalanceDay {
  date: string
  dap: number
  kc: number
  etc: number
  rain: number
  taw: number
  trigger: number
  depletionRec: number // model-scheduled irrigation
  irrRecGross: number
  depletionRainOnly: number
  appliedGross: number
  depletionApplied: number | null // with what was actually applied (null when nothing logged)
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000)
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)

export function kcOn(dap: number, crop: Crop): number {
  const [ini, mid, end, [a, b, m, l]] = SETTINGS.kc[crop]
  if (dap < 0) return 0
  if (dap <= a) return ini
  if (dap <= a + b) return ini + ((dap - a) / b) * (mid - ini)
  if (dap <= a + b + m) return mid
  if (dap <= a + b + m + l) return mid + ((dap - a - b - m) / l) * (end - mid)
  return 0
}

/** Total available water (in) in the root zone, from SSURGO 0-50 cm and 50-100 cm storage. */
export function tawIn(rootIn: number, s: Soil): number {
  const top = s.aws50, sub = s.aws100 - s.aws50
  return (top * Math.min(rootIn, 19.7)) / 19.7 + (sub * Math.max(0, rootIn - 19.7)) / 19.7
}

export function triggerFraction(crop: Crop, dap: number): number {
  const [a, b, p] = SETTINGS.cornPeakTrigger
  return crop === 'Corn' && dap >= a && dap <= b ? p : SETTINGS.trigger
}

interface RunOut { dr: number[]; irr: number[]; taw: number[]; raw: number[] }

function run(inp: BalanceInput, etc: number[], irrFixed: number[] | null, schedule: boolean): RunOut {
  const n = inp.dates.length
  const dr = new Array(n).fill(0), irr = new Array(n).fill(0), taw = new Array(n).fill(0), raw = new Array(n).fill(0)
  let d = 0, pending = 0
  for (let t = 0; t < n; t++) {
    const dap = dayDiff(inp.dates[t], inp.plantDate)
    if (dap < 0) continue
    const root = Math.min(SETTINGS.rootStartIn + SETTINGS.rootGrowthInPerDay * dap, SETTINGS.rootMaxIn[inp.crop])
    taw[t] = tawIn(root, inp.soil)
    raw[t] = triggerFraction(inp.crop, dap) * taw[t]
    if (dap === 0) d = 0 // start the season at field capacity
    const i = schedule ? pending : irrFixed ? irrFixed[t] : 0
    pending = 0
    const r = inp.rain[t] >= SETTINGS.minRainIn ? inp.rain[t] : 0
    d = d + etc[t] - r - i
    if (d < 0) d = 0
    d = Math.min(d, taw[t])
    dr[t] = d
    irr[t] = i
    if (schedule && dap <= SETTINGS.stopDap[inp.crop] && d >= raw[t]) pending = Math.min(d, SETTINGS.maxNetIn[inp.crop]) // apply tomorrow
  }
  return { dr, irr, taw, raw }
}

export function runBalance(inp: BalanceInput): BalanceDay[] {
  const dap = inp.dates.map((d) => dayDiff(d, inp.plantDate))
  const kc = dap.map((x) => kcOn(x, inp.crop))
  const etc = kc.map((k, t) => k * inp.eto[t])
  const rec = run(inp, etc, null, true)
  const rainOnly = run(inp, etc, null, false)
  const hasApplied = !!inp.appliedGross && inp.appliedGross.some((x) => x > 0)
  const applied = hasApplied ? run(inp, etc, inp.appliedGross!.map((x) => x * SETTINGS.efficiency), false) : null
  const out: BalanceDay[] = []
  for (let t = 0; t < inp.dates.length; t++) {
    if (dap[t] < 0) continue
    out.push({
      date: inp.dates[t], dap: dap[t], kc: kc[t], etc: etc[t], rain: inp.rain[t], taw: rec.taw[t], trigger: rec.raw[t],
      depletionRec: rec.dr[t], irrRecGross: rec.irr[t] / SETTINGS.efficiency, depletionRainOnly: rainOnly.dr[t],
      appliedGross: inp.appliedGross?.[t] ?? 0, depletionApplied: applied ? applied.dr[t] : null,
    })
  }
  return out
}

export type Status = 'now' | 'soon' | 'ok' | 'off' | 'none'

export interface Advice {
  status: Status
  pctDry: number // depletion as % of TAW
  daysToTrigger: number | null
  recommendGrossIn: number // what to put on now (gross), 0 if not needed
  line: string // plain-language action line
}

/**
 * What the crew should do on the last day of the balance. Uses the "applied" run when water has been
 * logged, else rain-only. Days to trigger uses the last 7 days of crop ET.
 */
export function advise(days: BalanceDay[], crop: Crop): Advice {
  if (!days.length) return { status: 'none', pctDry: 0, daysToTrigger: null, recommendGrossIn: 0, line: 'Not planted yet' }
  const last = days[days.length - 1]
  if (last.dap > SETTINGS.stopDap[crop]) return { status: 'off', pctDry: 0, daysToTrigger: null, recommendGrossIn: 0, line: 'Season done for water' }
  const dep = last.depletionApplied ?? last.depletionRainOnly
  const pctDry = last.taw > 0 ? (100 * dep) / last.taw : 0
  const recent = days.slice(-7)
  const et = recent.reduce((s, d) => s + d.etc, 0) / recent.length
  const room = last.trigger - dep
  const recommendGrossIn = dep >= last.trigger ? Math.min(dep, SETTINGS.maxNetIn[crop]) / SETTINGS.efficiency : 0
  if (room <= 0) return { status: 'now', pctDry, daysToTrigger: 0, recommendGrossIn, line: 'Water now' }
  const daysToTrigger = et > 0 ? Math.floor(room / et) : null
  if (daysToTrigger !== null && daysToTrigger <= 2) {
    const by = addDays(last.date, daysToTrigger)
    const wd = new Date(by + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    return { status: 'soon', pctDry, daysToTrigger, recommendGrossIn, line: `Water by ${wd}` }
  }
  return { status: 'ok', pctDry, daysToTrigger, recommendGrossIn, line: daysToTrigger === null ? 'OK' : `OK for ${daysToTrigger} days` }
}
