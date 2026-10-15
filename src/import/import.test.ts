import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { buildReport, toCSV } from '../reports/reports'
import { loadState } from '../domain/farm'
import { applyFields, parseFieldRows, planFields } from './fields'
import { applyPivotInfo, planPivotInfo } from './pivotInfo'
import { acresOf } from './boundaries'
import { toDate } from './read'

const square = (lon: number, lat: number, d = 0.01) => ({ type: 'Polygon' as const, coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] })

beforeEach(async () => { await db.delete(); await db.open() })

describe('field import', () => {
  it('matches boundaries by name, flags problems, and re-import updates in place', async () => {
    const rows = parseFieldRows([
      { Farm: 'Hodges Farm', Field: 'Hodges #4', Pivot: 'Hodges 4', Crop: 'corn', Acres: '151', 'Plant date': '3/20/2026' },
      { Farm: 'Hodges Farm', Field: 'Hodges #5', Pivot: 'Hodges 5', Crop: 'Cotton', Acres: '147' },
    ])
    const shapes = [{ name: 'HODGES #4', farm: null, geometry: square(-84.1, 32.0, 0.0115), props: {} }, { name: 'Stray', farm: null, geometry: square(-84, 32), props: {} }]
    const plan = await planFields(rows, shapes, 2026)
    expect(plan.found).toBe(2)
    expect(plan.isNew).toBe(2)
    expect(plan.items[0].row.plantDate).toBe('2026-03-20')
    expect(plan.items[1].problems).toEqual(['No boundary matched', 'No planting date'])
    expect(plan.unmatchedShapes.map((s) => s.name)).toEqual(['Stray'])
    await applyFields(plan, 'list.csv', 'Bo')
    const again = await planFields(rows, shapes, 2026)
    expect(again.matched).toBe(2)
    await applyFields(again, 'list.csv', 'Bo')
    expect(await db.fields.count()).toBe(2)
    expect(await db.pivots.count()).toBe(2)
    expect(await db.cropSeasons.count()).toBe(2)
    expect(await db.imports.count()).toBe(2)
  })
})

describe('pivot info sheet import', () => {
  it('fills the profile by System ID or AgSense name, never erasing with blanks', async () => {
    await applyFields(await planFields(parseFieldRows([{ Farm: 'A&B Farm', Field: 'A&B #10', Pivot: 'A&B 10', Crop: 'Corn', Acres: 65, 'Plant date': '2026-03-10' }]), [], 2026), 'x', 'Bo')
    const sheet = [
      { 'System ID': 'A&B 10', Farm: 'A&B Farm', 'AgSense name': 'A&B 10', 'AgSense gpm (typed in)': 1112, 'Irrigated acres (design or FSA)': 70, 'Design flow (gpm)': '', 'Hours per rev at 100%': 14, 'Tier 1 done': '=LEN(M5)' },
      { 'System ID': 'New 1', Farm: 'Other Farm', 'Design flow (gpm)': 800 },
    ]
    const plan = await planPivotInfo(sheet)
    expect(plan.matched).toBe(1)
    expect(plan.isNew).toBe(1)
    expect(plan.items[1].problems).toContain('No irrigated acres')
    await applyPivotInfo(plan, 'pivot_info.xlsx', 'Bo')
    const p = (await db.pivots.where('name').equals('A&B 10').first())!
    expect(p.profile.irrigatedAcres).toMatchObject({ value: 70, source: 'pivot info sheet' })
    expect(p.profile.agsenseGpm).toMatchObject({ value: 1112, source: 'AgSense setting' })
    expect(p.profile.flowGpm).toBeUndefined()
    await applyPivotInfo(await planPivotInfo([{ 'System ID': 'A&B 10', 'Irrigated acres (design or FSA)': '' }]), 'again.xlsx', 'Bo')
    expect((await db.pivots.get(p.id))!.profile.irrigatedAcres.value).toBe(70)
  })
})

describe('reports', () => {
  it('run records list every run and export clean CSV', async () => {
    await applyFields(await planFields(parseFieldRows([{ Farm: 'Hodges Farm', Field: 'Hodges #4', Pivot: 'Hodges 4', Crop: 'Corn', Acres: 151, 'Plant date': '2026-03-20' }]), [], 2026), 'x', 'Bo')
    await applyPivotInfo(await planPivotInfo([{ 'System ID': 'Hodges 4', 'Design flow (gpm)': 1000, 'Irrigated acres (design or FSA)': 151 }]), 'p.xlsx', 'Bo')
    const p = (await db.pivots.toArray())[0]
    await db.entries.bulkAdd([
      { id: 'a', pivotId: p.id, action: 'on', happenedAt: '2026-07-01T14:00:00Z', recordedAt: '2026-07-01T14:00:00Z', who: 'Juan, crew', how: 'app', percentTimer: 60, synced: 0 },
      { id: 'b', pivotId: p.id, action: 'off', happenedAt: '2026-07-02T14:00:00Z', recordedAt: '2026-07-02T14:00:00Z', who: 'Juan, crew', how: 'app', madeItAround: true, synced: 0 },
    ])
    await db.settings.put({ key: 'asOf', value: '2026-07-31' })
    const s = await loadState()
    const r = buildReport('runs', s, { farm: '', crop: '', from: '2026-01-01', to: '2026-07-31' }, 'JA Minor')
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].hours).toBe(24)
    expect(r.answer).toMatch(/^1 runs, 24 pivot-hours/)
    const csv = toCSV(r).split('\r\n')
    expect(csv[0]).toMatch(/^Farm,Pivot,Fields,On,Off,Hours \(h\)/)
    expect(csv[1]).toContain('"Juan, crew"')
    expect(csv[1]).toContain(',24.0,60,')
  })
})

describe('helpers', () => {
  it('reads dates and areas', () => {
    expect(toDate(46100)).toBe('2026-03-19')
    expect(toDate('2026-04-01T00:00:00')).toBe('2026-04-01')
    const a = acresOf(square(-84, 32, 0.01))
    expect(a).toBeGreaterThan(250); expect(a).toBeLessThan(260) // ~0.01° x 0.01° at 32°N is about 254 ac
  })
})

describe('AgSense weekly import', () => {
  it('matches by alias, counts dry hours on pivots that read dry, and skips a week already imported', async () => {
    await applyFields(await planFields(parseFieldRows([
      { Farm: 'Hodges Farm', Field: 'Hodges #3', Pivot: 'Hodges 3', Crop: 'Peanuts', Acres: 100, 'Plant date': '2026-05-01' },
      { Farm: 'Hodges Farm', Field: 'Hodges #7', Pivot: 'Hodges 7', Crop: 'Peanuts', Acres: 80, 'Plant date': '2026-05-01' },
    ]), [], 2026), 'x', 'Bo')
    for (const n of ['Hodges 3', 'Hodges 7']) { const p = (await db.pivots.where('name').equals(n).first())!; p.agsenseName = n; await db.pivots.put(p) }
    const { planAgSense, applyAgSense } = await import('./agsense')
    const rows = [
      { 'Group Name': 'Hodges', Serial: '111', Alias: 'Hodges 3', 'Wet Walking Hours': '30.5', 'Dry Walking Hours': '2' },
      { 'Group Name': 'Hodges', Serial: '222', Alias: 'Hodges 7 ', 'Wet Walking Hours': '0', 'Dry Walking Hours': '40' },
      { 'Group Name': 'X', Serial: '333', Alias: 'Nowhere 1', 'Wet Walking Hours': '5', 'Dry Walking Hours': '0' },
    ]
    const plan = await planAgSense(rows, '2026-07-06', '2026-07-12')
    expect(plan.matched).toBe(2)
    expect(plan.items.map((i) => i.hours)).toEqual([30.5, 40, 5])
    expect(plan.items[1].problems[0]).toMatch(/Reads dry/)
    await applyAgSense(plan, 'week.csv', 'Bo')
    expect(await db.entries.count()).toBe(2)
    const again = await planAgSense(rows, '2026-07-06', '2026-07-12')
    expect(again.items.filter((i) => i.duplicate)).toHaveLength(2)
    await applyAgSense(again, 'week.csv', 'Bo')
    expect(await db.entries.count()).toBe(2)
    const h7 = (await db.pivots.where('name').equals('Hodges 7').first())!
    expect(h7.profile.agsenseReadsDry.value).toBe('yes')
  })
})

describe('clients', () => {
  it('keeps each client to its own farms, fields and pivots', async () => {
    const { addClient, listClients } = await import('../domain/client')
    const { setSetting } = await import('../db')
    const rows = parseFieldRows([{ Farm: 'Home', Field: 'North 1', Pivot: 'North 1', Crop: 'Corn', Acres: '120', 'Plant date': '4/1/2026' }])
    await applyFields(await planFields(rows, [], 2026), 'a.csv', 'Bo')
    expect((await listClients()).map((c) => c.name)).toEqual(['Main client']) // older farms land under the default client
    const b = await addClient('Smith Farms')
    const plan = await planFields(rows, [], 2026)
    expect(plan.isNew).toBe(1) // the same field name under another client is a new field, not a match
    await applyFields(plan, 'b.csv', 'Bo')
    expect((await db.fields.count())).toBe(2)
    const sb = await loadState()
    expect(sb.clientId).toBe(b.id)
    expect(sb.fields.length).toBe(1)
    expect(sb.farms[0].clientId).toBe(b.id)
    await setSetting('clientId', 'default')
    const sa = await loadState()
    expect(sa.fields.map((f) => f.farm.clientId)).toEqual(['default'])
  })
})
