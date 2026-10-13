import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { advise, isCrop, runBalance } from './waterBalance'

// The app's water balance must match model/water_balance.py day for day.
const demo = JSON.parse(readFileSync(new URL('../../public/demo/ja_minor_2026.json', import.meta.url), 'utf8'))
const py = Papa.parse<Record<string, string>>(readFileSync(new URL('../test/fixtures/python_balance_2026.csv', import.meta.url), 'utf8'), {
  header: true, skipEmptyLines: true,
}).data

describe('water balance matches the Python model', () => {
  for (const name of ['A&B #1', 'Akin #1N', 'A&B #2A']) {
    it(name, () => {
      const f = demo.fields.find((x: any) => x.name === name)
      const p = demo.pivots.find((x: any) => x.name === f.pivot)
      expect(isCrop(f.crop)).toBe(true)
      const out = runBalance({ crop: f.crop, plantDate: f.plantDate, soil: p, dates: demo.dates, eto: demo.eto, rain: p.rain })
      const rows = py.filter((r) => r.field === name)
      expect(out.length).toBe(rows.length)
      rows.forEach((r, i) => {
        const o = out[i]
        expect(o.date).toBe(r.date)
        expect(o.dap).toBe(Number(r.dap))
        // Python rounds its outputs to 2 places; the app keeps full precision.
        expect(Math.abs(o.taw - Number(r.taw_in))).toBeLessThan(0.006)
        expect(Math.abs(o.depletionRainOnly - Number(r.depletion_rain_only_in))).toBeLessThan(0.006)
        expect(Math.abs(o.depletionRec - Number(r.depletion_rec_in))).toBeLessThan(0.006)
      })
      const recTotal = out.reduce((s, d) => s + d.irrRecGross, 0)
      const pyTotal = rows.reduce((s, r) => s + Number(r.irr_rec_gross_in), 0)
      expect(Math.abs(recTotal - pyTotal)).toBeLessThan(0.1)
    })
  }
})

describe('advice', () => {
  it('says water now when past the trigger', () => {
    const a = advise([{ date: '2026-07-01', dap: 60, kc: 1, etc: 0.25, rain: 0, taw: 2, trigger: 0.9, depletionRec: 0, irrRecGross: 0,
      depletionRainOnly: 1.2, appliedGross: 0, depletionApplied: null }], 'Corn')
    expect(a.status).toBe('now')
    expect(a.recommendGrossIn).toBeCloseTo(1.0 / 0.85)
  })
})
