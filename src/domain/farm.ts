import { db, getSetting, uid, type CropSeason, type Entry, type Farm, type Field, type Pivot } from '../db'
import { advise, isCrop, runBalance, type Advice, type BalanceDay } from '../model/waterBalance'
import { buildRuns, dailyApplied, type Run } from './runs'
import { num } from './pivot'

// Everything a screen needs, computed from the local database: fields with today's water balance,
// pivots with their runs. Small enough (a farm is ~100 fields) to recompute on every change.

export interface FieldView { field: Field; farm: Farm; pivot: Pivot | null; season: CropSeason | null; days: BalanceDay[]; advice: Advice; appliedIn: number; rainIn: number; needIn: number }
export interface PivotView { pivot: Pivot; farm: Farm; fields: Field[]; acres: number | null; runs: Run[]; running: Run | null; lastRun: Run | null }
export interface FarmState { asOf: string; year: number; farms: Farm[]; fields: FieldView[]; pivots: PivotView[]; entries: Entry[]; weatherFrom: string | null; weatherTo: string | null; weatherSource: string }

export async function loadState(): Promise<FarmState> {
  const [farms, fields, pivots, seasons, entries, weather] = await Promise.all([
    db.farms.toArray(), db.fields.toArray(), db.pivots.toArray(), db.cropSeasons.toArray(), db.entries.toArray(), db.weather.orderBy('date').toArray(),
  ])
  const today = new Date().toISOString().slice(0, 10)
  const asOfSetting = await getSetting<string | null>('asOf', null)
  const asOf = asOfSetting || today
  const year = Number(asOf.slice(0, 4))
  const farmById = new Map(farms.map((f) => [f.id, f]))
  const seasonByField = new Map(seasons.filter((s) => s.year === year).map((s) => [s.fieldId, s]))

  const pviews: PivotView[] = pivots.map((p) => {
    const fs = fields.filter((f) => f.pivotId === p.id)
    const acres = num(p, 'irrigatedAcres') ?? (fs.reduce((s, f) => s + (seasonByField.get(f.id)?.acres ?? 0), 0) || null)
    const runs = buildRuns(entries, p, acres)
    return { pivot: p, farm: farmById.get(p.farmId)!, fields: fs, acres, runs, running: runs.find((r) => r.start && !r.stop) ?? null, lastRun: runs.filter((r) => r.stop).at(-1) ?? null }
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
    const base = { field: f, farm: farmById.get(f.farmId)!, pivot, season, days: [] as BalanceDay[], appliedIn: 0, rainIn: 0, needIn: 0 }
    if (!season || !isCrop(season.crop) || !season.plantDate || !pivot || pivot.aws50 == null || pivot.aws100 == null || !dates.length)
      return { ...base, advice: { status: 'none', pctDry: 0, daysToTrigger: null, recommendGrossIn: 0, line: !season ? 'No crop this year' : !dates.length ? 'No weather yet' : pivot?.aws50 == null ? 'No soil data' : 'Not modeled' } as Advice }
    const rmap = rainBy.get(pivot.id) ?? new Map()
    const applied = dailyApplied(pvById.get(pivot.id)!.runs)
    const days = runBalance({
      crop: season.crop, plantDate: season.plantDate, soil: { aws50: pivot.aws50, aws100: pivot.aws100 }, dates, eto,
      rain: dates.map((d) => rmap.get(d) ?? 0), appliedGross: dates.map((d) => applied.get(d) ?? 0),
    })
    return {
      ...base, days, advice: advise(days, season.crop),
      appliedIn: days.reduce((s, d) => s + d.appliedGross, 0), rainIn: days.reduce((s, d) => s + d.rain, 0), needIn: days.reduce((s, d) => s + d.irrRecGross, 0),
    }
  }).sort((a, b) => a.field.name.localeCompare(b.field.name, undefined, { numeric: true }))

  const wsrc = weather.at(-1)?.source ?? ''
  return { asOf, year, farms: farms.sort((a, b) => a.name.localeCompare(b.name)), fields: fviews, pivots: pviews, entries, weatherFrom: weather[0]?.date ?? null, weatherTo: weather.at(-1)?.date ?? null, weatherSource: wsrc }
}

/** Load the JA Minor 2026 demo farm (fields, boundaries, soils, weather) into an empty app. */
export async function loadDemo(url = './demo/ja_minor_2026.json') {
  const demo = await (await fetch(url)).json()
  await db.transaction('rw', [db.farms, db.fields, db.pivots, db.cropSeasons, db.weather, db.rain, db.imports, db.settings], async () => {
    const farms = new Map<string, string>()
    for (const name of new Set<string>([...demo.pivots.map((p: any) => p.farm), ...demo.fields.map((f: any) => f.farm)])) {
      const id = uid(); farms.set(name, id); await db.farms.add({ id, name })
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
  })
}

export async function clearAll() {
  await db.delete()
  location.reload()
}
