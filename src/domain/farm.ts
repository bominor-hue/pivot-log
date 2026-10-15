import { DEFAULT_CLIENT, db, getSetting, uid, type CropSeason, type Entry, type Farm, type Field, type Pivot, type ProbeReading } from '../db'
import { advise, isCrop, runBalance, type Advice, type BalanceDay } from '../model/waterBalance'
import { buildRuns, dailyApplied, learnLapHours, type Run } from './runs'
import { hoursPerPass, num } from './pivot'
import { clientOf, listClients, pickClient } from './client'

// Everything a screen needs, computed from the local database: fields with today's water balance,
// pivots with their runs. Small enough (a farm is ~100 fields) to recompute on every change.

export interface FieldView {
  field: Field; farm: Farm; pivot: Pivot | null; season: CropSeason | null; days: BalanceDay[]; advice: Advice; appliedIn: number; rainIn: number; needIn: number
  probes: ProbeReading[]
  probeGap: { date: string; probe: number; model: number } | null // latest reading more than 15 points off the model
}
export interface PivotView { pivot: Pivot; farm: Farm; fields: Field[]; acres: number | null; runs: Run[]; running: Run | null; lastRun: Run | null
  lapHours100: { hours: number; source: string } | null // hours per lap at 100%: dealer chart, else learned from laps
}
export interface FarmState { clientId: string; asOf: string; year: number; farms: Farm[]; fields: FieldView[]; pivots: PivotView[]; entries: Entry[]; weatherFrom: string | null; weatherTo: string | null; weatherSource: string }

export async function loadState(): Promise<FarmState> {
  const [allFarms, allFields, allPivots, seasons, allEntries, weather, allProbes, clients, picked] = await Promise.all([
    db.farms.toArray(), db.fields.toArray(), db.pivots.toArray(), db.cropSeasons.toArray(), db.entries.toArray(), db.weather.orderBy('date').toArray(), db.probes.toArray(),
    listClients(), getSetting<string | null>('clientId', null),
  ])
  // Only the picked client's farms, and the fields, pivots, entries and probe readings under them.
  const clientId = pickClient(clients, picked)
  const farms = allFarms.filter((f) => clientOf(f) === clientId)
  const farmIds = new Set(farms.map((f) => f.id))
  const fields = allFields.filter((f) => farmIds.has(f.farmId)), pivots = allPivots.filter((p) => farmIds.has(p.farmId))
  const pivotIds = new Set(pivots.map((p) => p.id)), fieldIds = new Set(fields.map((f) => f.id))
  const entries = allEntries.filter((e) => pivotIds.has(e.pivotId)), probes = allProbes.filter((x) => fieldIds.has(x.fieldId))
  const today = new Date().toISOString().slice(0, 10)
  const asOfSetting = await getSetting<string | null>('asOf', null)
  const asOf = asOfSetting || today
  const year = Number(asOf.slice(0, 4))
  const farmById = new Map(farms.map((f) => [f.id, f]))
  const seasonByField = new Map(seasons.filter((s) => s.year === year).map((s) => [s.fieldId, s]))

  const pviews: PivotView[] = pivots.map((p) => {
    const fs = fields.filter((f) => f.pivotId === p.id)
    const acres = num(p, 'irrigatedAcres') ?? (fs.reduce((s, f) => s + (seasonByField.get(f.id)?.acres ?? 0), 0) || null)
    const chart = num(p, 'hoursPerRev100')
    const learned = chart ? null : learnLapHours(buildRuns(entries, p, acres), num(p, 'arcDeg') ?? 360)
    const lapHours100 = chart ? { hours: chart, source: p.profile.hoursPerRev100.source } : learned ? { hours: learned.hours, source: `learned from ${learned.laps} lap${learned.laps > 1 ? 's' : ''} (estimate)` } : null
    const runs = buildRuns(entries, p, acres, new Date(), learned?.hours ?? null)
    return { pivot: p, farm: farmById.get(p.farmId)!, fields: fs, acres, runs, running: runs.find((r) => r.start && !r.stop) ?? null, lastRun: runs.filter((r) => r.stop).at(-1) ?? null, lapHours100 }
  }).sort((a, b) => a.pivot.name.localeCompare(b.pivot.name, undefined, { numeric: true }))
  const pvById = new Map(pviews.map((v) => [v.pivot.id, v]))

  const wx = weather.filter((w) => w.date.startsWith(String(year)) && w.date <= asOf)
  const dates = wx.map((w) => w.date)
  const eto = wx.map((w) => w.eto)
  const rainRows = dates.length ? await db.rain.where('date').between(dates[0], dates[dates.length - 1], true, true).toArray() : []
  const rainBy = new Map<string, Map<string, number>>()
  for (const r of rainRows) { if (!rainBy.has(r.pivotId)) rainBy.set(r.pivotId, new Map()); rainBy.get(r.pivotId)!.set(r.date, r.inches) }

  const fviews: FieldView[] = fields.map((f) => {
    const season = seasonByField.get(f.id) ?? null
    const pivot = f.pivotId ? pvById.get(f.pivotId)?.pivot ?? null : null
    const fp = probes.filter((x) => x.fieldId === f.id && x.date <= asOf).sort((a, b) => a.date.localeCompare(b.date))
    const base = { field: f, farm: farmById.get(f.farmId)!, pivot, season, days: [] as BalanceDay[], appliedIn: 0, rainIn: 0, needIn: 0, probes: fp, probeGap: null }
    if (!season || !isCrop(season.crop) || !season.plantDate || !pivot || pivot.aws50 == null || pivot.aws100 == null || !dates.length)
      return { ...base, advice: { status: 'none', pctDry: 0, daysToTrigger: null, startInDays: null, recommendGrossIn: 0, weekGrossIn: 0, cropUsePerDay: 0, lapDays: 0, line: !season ? 'No crop this year' : !dates.length ? 'No weather yet' : pivot?.aws50 == null ? 'No soil data' : 'Not modeled' } as Advice }
    const rmap = rainBy.get(pivot.id) ?? new Map()
    const applied = dailyApplied(pvById.get(pivot.id)!.runs)
    const days = runBalance({
      crop: season.crop, plantDate: season.plantDate, soil: { aws50: pivot.aws50, aws100: pivot.aws100 }, dates, eto,
      rain: dates.map((d) => rmap.get(d) ?? 0), appliedGross: dates.map((d) => applied.get(d) ?? 0),
    })
    const pvw = pvById.get(pivot.id)!
    const lastPct = state_lastPct(entries, pivot.id)
    const lapHours = pvw.lapHours100 ? hoursPerPass(pivot, lastPct, pvw.lapHours100.hours) : null
    const lp = fp.at(-1), md = lp && days.find((d) => d.date === lp.date)
    const modelPct = md && md.taw > 0 ? (100 * (md.depletionApplied ?? md.depletionRainOnly)) / md.taw : null
    const probeGap = lp && modelPct !== null && Math.abs(lp.pctUsed - modelPct) > 15 ? { date: lp.date, probe: lp.pctUsed, model: modelPct } : null
    return {
      ...base, days, probeGap, advice: advise(days, season.crop, lapHours),
      appliedIn: days.reduce((s, d) => s + d.appliedGross, 0), rainIn: days.reduce((s, d) => s + d.rain, 0), needIn: days.reduce((s, d) => s + d.irrRecGross, 0),
    }
  }).sort((a, b) => a.field.name.localeCompare(b.field.name, undefined, { numeric: true }))

  const wsrc = weather.at(-1)?.source ?? ''
  return { clientId, asOf, year, farms: farms.sort((a, b) => a.name.localeCompare(b.name)), fields: fviews, pivots: pviews, entries, weatherFrom: weather[0]?.date ?? null, weatherTo: weather.at(-1)?.date ?? null, weatherSource: wsrc }
}

/** Percent timer of the pivot's last ON (100 if none), used to size the lap for the recommendation. */
function state_lastPct(entries: Entry[], pivotId: string): number {
  const on = entries.filter((e) => e.pivotId === pivotId && (e.action === 'on' || e.action === 'run') && e.percentTimer).sort((a, b) => b.happenedAt.localeCompare(a.happenedAt))[0]
  return on?.percentTimer ?? 100
}

/** Load the JA Minor 2026 demo farm (fields, boundaries, soils, weather) into an empty app. */
export async function loadDemo(url = './demo/ja_minor_2026.json') {
  const demo = await (await fetch(url)).json()
  await db.transaction('rw', [db.clients, db.farms, db.fields, db.pivots, db.cropSeasons, db.weather, db.rain, db.imports, db.settings], async () => {
    await db.clients.put({ id: DEFAULT_CLIENT, name: 'JA Minor Family Farms' })
    await db.settings.put({ key: 'clientId', value: DEFAULT_CLIENT })
    const farms = new Map<string, string>()
    for (const name of new Set<string>([...demo.pivots.map((p: any) => p.farm), ...demo.fields.map((f: any) => f.farm)])) {
      const id = uid(); farms.set(name, id); await db.farms.add({ id, name, clientId: DEFAULT_CLIENT })
    }
    const pid = new Map<string, string>()
    const at = new Date().toISOString()
    const rain: { pivotId: string; date: string; inches: number; source: string }[] = []
    for (const p of demo.pivots) {
      const id = uid(); pid.set(p.name, id)
      await db.pivots.add({ id, farmId: farms.get(p.farm)!, name: p.name, agsenseName: p.agsenseName, lat: p.lat, lon: p.lon, soil: p.soil, aws50: p.aws50, aws100: p.aws100,
        profile: Object.fromEntries(Object.entries(p.profile ?? {}).map(([k, v]: [string, any]) => [k, { ...v, at }])) })
      demo.dates.forEach((d: string, i: number) => rain.push({ pivotId: id, date: d, inches: p.rain[i] ?? 0, source: 'NOAA MRMS' }))
    }
    await db.rain.bulkPut(rain)
    for (const f of demo.fields) {
      const id = uid()
      await db.fields.add({ id, farmId: farms.get(f.farm)!, name: f.name, pivotId: pid.get(f.pivot) ?? null, fsn: f.fsn, county: f.county, boundary: f.boundary })
      await db.cropSeasons.add({ id: uid(), fieldId: id, year: demo.year, crop: f.crop, acres: f.acres, plantDate: f.plantDate })
    }
    await db.weather.bulkPut(demo.dates.map((d: string, i: number) => ({ date: d, eto: demo.eto[i], source: 'ETo est. FAO-56 (Plains RAWS)' })))
    await db.imports.add({ id: uid(), kind: 'demo', fileName: 'ja_minor_2026.json', at, who: 'demo', summary: `${demo.fields.length} fields, ${demo.pivots.length} pivots, ${demo.dates.length} days of weather` })
    await db.settings.put({ key: 'asOf', value: '2026-07-16' })
    await db.settings.put({ key: 'demo', value: true })
    await db.settings.put({ key: 'imagery', value: { url: './imagery/sentinel2_20260624.jpg', bounds: [-84.43, 31.89, -83.95, 32.21], label: 'Sentinel-2, June 24, 2026 (ESA Copernicus)' } })
  })
}

export async function clearAll() {
  await db.delete()
  location.reload()
}
