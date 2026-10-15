import { clientScope } from '../domain/client'
import { db, uid, type Pivot } from '../db'
import { setProfile } from '../domain/pivot'
import { norm, toNum, type Row } from './read'

// Pivot info sheet: the "Fill in" tab of systems/pivot_info_collection.xlsx. One row per pivot, same
// columns on every farm. Matched by System ID or AgSense name. Blank cells never erase what's there.

/** Sheet column -> profile key, and the source tag each value gets. */
export const PIVOT_INFO_COLUMNS: { col: string; key: string; numeric?: boolean; source?: string }[] = [
  { col: 'Irrigated acres (design or FSA)', key: 'irrigatedAcres', numeric: true },
  { col: 'Design flow (gpm)', key: 'flowGpm', numeric: true },
  { col: 'Hours per rev at 100%', key: 'hoursPerRev100', numeric: true },
  { col: 'Full or part circle (deg)', key: 'arcDeg', numeric: true },
  { col: 'End gun (Y/N, model)', key: 'endGun' },
  { col: 'Sprinkler package', key: 'sprinklerPackage' },
  { col: 'Water source', key: 'waterSource' },
  { col: 'Other pivots on same source', key: 'sharedSource' },
  { col: 'Design pressure (psi)', key: 'designPsi', numeric: true },
  { col: 'Wetted radius incl. end gun (ft)', key: 'wettedRadiusFt', numeric: true },
  { col: 'Length to last tower (ft)', key: 'lengthFt', numeric: true },
  { col: 'Towers (#)', key: 'towers', numeric: true },
  { col: 'Pivot make', key: 'make' },
  { col: 'Model', key: 'model' },
  { col: 'Control panel', key: 'controlPanel' },
  { col: 'Crop Link model', key: 'cropLinkModel' },
  { col: 'Flow meter', key: 'flowMeter' },
  { col: 'Pressure transducer', key: 'pressureTransducer' },
  { col: 'Rain gauge', key: 'rainGauge' },
  { col: 'Position sensing', key: 'positionSensing' },
  { col: 'Measured flow (gpm, date)', key: 'measuredGpm', numeric: true, source: 'measured' },
  { col: 'Dealer', key: 'dealer' },
  { col: 'Well / intake ID', key: 'wellId' },
  { col: 'Power source', key: 'powerSource' },
  { col: 'Drive type', key: 'driveType' },
  { col: 'FSA farm # (FSN)', key: 'fsn' },
  { col: 'FSA tract / CLU', key: 'tractClu' },
  { col: 'GA EPD withdrawal permit #', key: 'epdPermit' },
  { col: 'State ag water meter ID', key: 'stateMeterId' },
  { col: 'Power supplier / meter #', key: 'powerMeter' },
  { col: 'Install year', key: 'installYear' },
  { col: 'Pivot serial / order #', key: 'serial' },
  { col: 'Pump type', key: 'pumpType' },
  { col: 'Pump/motor hp', key: 'pumpHp', numeric: true },
  { col: 'Well depth / aquifer', key: 'wellDepth' },
  { col: 'EQIP / CSP history', key: 'eqipHistory' },
  { col: 'Known problems', key: 'knownProblems' },
  { col: 'Last service / repair', key: 'lastService' },
  { col: 'AgSense gpm (typed in)', key: 'agsenseGpm', numeric: true, source: 'AgSense setting' },
  { col: 'AgSense acres setting', key: 'agsenseAcres', numeric: true, source: 'AgSense setting' },
]

export interface PivotPlanItem { system: string; farm: string; agsense: string | null; existing: Pivot | null; values: { key: string; value: any; source: string }[]; problems: string[] }
export interface PivotPlan { items: PivotPlanItem[]; found: number; matched: number; isNew: number; needsLook: number; filledCells: number }

export const isPivotInfoHeader = (cells: string[]) => cells.some((c) => c.trim() === 'System ID')

export async function planPivotInfo(rows: Row[]): Promise<PivotPlan> {
  const pivots = (await clientScope()).pivots // names match only within the picked client
  const byName = new Map(pivots.map((p) => [norm(p.name), p]))
  const byAg = new Map(pivots.filter((p) => p.agsenseName).map((p) => [norm(p.agsenseName), p]))
  const cell = (r: Row, col: string) => { const k = Object.keys(r).find((k) => norm(k) === norm(col)); return k ? r[k] : null }
  const items: PivotPlanItem[] = []
  for (const r of rows) {
    const system = String(cell(r, 'System ID') ?? '').trim()
    if (!system) continue
    const agsense = cell(r, 'AgSense name') ? String(cell(r, 'AgSense name')).trim() : null
    const existing = byName.get(norm(system)) ?? (agsense ? byAg.get(norm(agsense)) ?? null : null)
    const values: PivotPlanItem['values'] = []
    for (const c of PIVOT_INFO_COLUMNS) {
      let v = cell(r, c.col)
      if (v === null || v === undefined || String(v).trim() === '' || String(v).startsWith('=')) continue
      if (c.numeric) { v = toNum(v); if (v === null) continue }
      values.push({ key: c.key, value: typeof v === 'string' ? v.trim() : v, source: c.source ?? 'pivot info sheet' })
    }
    const problems: string[] = []
    const has = (k: string) => values.some((v) => v.key === k) || !!existing?.profile[k]
    if (!has('irrigatedAcres')) problems.push('No irrigated acres')
    if (!has('flowGpm') && !has('measuredGpm') && !has('agsenseGpm')) problems.push('No flow (gpm)')
    if (!has('hoursPerRev100')) problems.push('No hours per rev')
    items.push({ system, farm: String(cell(r, 'Farm') ?? '').trim(), agsense, existing, values, problems })
  }
  return {
    items, found: items.length, matched: items.filter((i) => i.existing).length, isNew: items.filter((i) => !i.existing).length,
    needsLook: items.filter((i) => i.problems.length).length, filledCells: items.reduce((s, i) => s + i.values.length, 0),
  }
}

export async function applyPivotInfo(plan: PivotPlan, fileName: string, who: string): Promise<string> {
  const at = new Date().toISOString()
  let changed = 0
  const scope = await clientScope()
  await db.transaction('rw', [db.pivots, db.farms, db.imports], async () => {
    const farms = new Map(scope.farms.map((f) => [norm(f.name), f]))
    for (const it of plan.items) {
      let p = it.existing ? await db.pivots.get(it.existing.id) : undefined
      if (!p) {
        let farm = farms.get(norm(it.farm || 'Unassigned'))
        if (!farm) { farm = { id: uid(), name: it.farm || 'Unassigned', clientId: scope.clientId }; await db.farms.add(farm); farms.set(norm(farm.name), farm) }
        p = { id: uid(), farmId: farm.id, name: it.system, agsenseName: it.agsense, profile: {} }
      }
      if (it.agsense && !p.agsenseName) p.agsenseName = it.agsense
      for (const v of it.values) if (setProfile(p, v.key, v.value, v.source, at)) changed++
      await db.pivots.put(p)
    }
    await db.imports.add({ id: uid(), kind: 'pivot info', fileName, at, who, summary: `${plan.found} pivots: ${plan.matched} matched, ${plan.isNew} new, ${changed} values updated` })
  })
  return `${plan.found} pivots, ${changed} values updated`
}
