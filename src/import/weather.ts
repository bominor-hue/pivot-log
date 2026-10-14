import { db, uid } from '../db'
import { norm, pick, toDate, toNum, type Row } from './read'

// Weather CSV: one row per day with ETo, and optionally rain. Rain can be one column for the whole
// farm, or a "pivot" column for rain by pivot (the NOAA MRMS layout).
export async function importWeather(rows: Row[], fileName: string, who: string, source: string): Promise<string> {
  const pivots = new Map((await db.pivots.toArray()).map((p) => [norm(p.name), p.id]))
  const allPivots = [...pivots.values()]
  let eto = 0, rain = 0, skipped = 0
  await db.transaction('rw', [db.weather, db.rain, db.imports], async () => {
    for (const r of rows) {
      const date = toDate(pick(r, 'date', 'day'))
      if (!date) { skipped++; continue }
      const e = toNum(pick(r, 'eto_in', 'eto', 'eto (in)', 'et0'))
      if (e !== null) { await db.weather.put({ date, eto: e, source }); eto++ }
      const rv = toNum(pick(r, 'rain_in', 'rain', 'rain (in)', 'precip_in'))
      if (rv === null) continue
      const pv = pick(r, 'pivot', 'pivot_unit', 'system id')
      const ids = pv ? [pivots.get(norm(pv))].filter(Boolean) as string[] : allPivots
      await db.rain.bulkPut(ids.map((pivotId) => ({ pivotId, date, inches: rv, source })))
      rain += ids.length
    }
    await db.imports.add({ id: uid(), kind: 'weather', fileName, at: new Date().toISOString(), who, summary: `${eto} days of ETo, ${rain} rain values, ${skipped} rows skipped` })
  })
  return `${eto} days of ETo, ${rain} rain values saved`
}
