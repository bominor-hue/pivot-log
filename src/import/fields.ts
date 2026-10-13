import { db, uid, type CropSeason, type Farm, type Field, type Pivot } from '../db'
import { acresOf, type Shape } from './boundaries'
import { norm, pick, toDate, toNum, type Row } from './read'

// Fields import: a field list (CSV/Excel) and/or boundaries, matched by field name.
// Re-importing updates fields in place; it never duplicates them.

export interface FieldRow { farm: string; name: string; pivot: string | null; crop: string | null; acres: number | null; plantDate: string | null; fsn: string | null; county: string | null }
export interface FieldPlanItem { row: FieldRow; shape: Shape | null; existing: Field | null; problems: string[] }
export interface FieldPlan { year: number; items: FieldPlanItem[]; unmatchedShapes: Shape[]; found: number; matched: number; isNew: number; needsLook: number }

export function parseFieldRows(rows: Row[]): FieldRow[] {
  return rows.map((r) => ({
    farm: String(pick(r, 'farm', 'farm name') ?? '').trim(),
    name: String(pick(r, 'field', 'field name', 'name') ?? '').trim(),
    pivot: (pick(r, 'pivot', 'pivot unit', 'pivot_unit', 'system id') ?? null) && String(pick(r, 'pivot', 'pivot unit', 'pivot_unit', 'system id')).trim(),
    crop: normalizeCrop(pick(r, 'crop', 'crop 2026', 'crop 2027', 'crop_2026', 'crop_2027')),
    acres: toNum(pick(r, 'acres', 'acres 2026', 'acres_2026', 'acres 2027', 'planted acres', 'irrigated acres')),
    plantDate: toDate(pick(r, 'plant date', 'plant_date', 'planting date', 'planted')),
    fsn: (pick(r, 'fsn', 'fsa farm', 'farm number') ?? null) && String(pick(r, 'fsn', 'fsa farm', 'farm number')),
    county: pick(r, 'county'),
  })).filter((r) => r.name)
}

export function normalizeCrop(v: any): string | null {
  const s = norm(v)
  if (!s) return null
  if (s.startsWith('corn')) return 'Corn'
  if (s.startsWith('cotton')) return 'Cotton'
  if (s.startsWith('peanut')) return 'Peanuts'
  return String(v).trim()
}

export async function planFields(rows: FieldRow[], shapes: Shape[], year: number): Promise<FieldPlan> {
  const existing = await db.fields.toArray()
  const byName = new Map(existing.map((f) => [norm(f.name), f]))
  const shapeBy = new Map(shapes.map((s) => [norm(s.name), s]))
  const used = new Set<string>()
  // A boundary file alone (no list) creates or updates fields straight from the shapes.
  const list: FieldRow[] = rows.length ? rows : shapes.map((s) => ({ farm: s.farm ?? '', name: s.name, pivot: null, crop: null, acres: null, plantDate: null, fsn: null, county: null }))
  const items = list.map((row) => {
    const shape = shapeBy.get(norm(row.name)) ?? null
    if (shape) used.add(norm(row.name))
    const ex = byName.get(norm(row.name)) ?? null
    const problems: string[] = []
    if (!row.farm && !ex) problems.push('No farm')
    if (shapes.length && !shape && !ex?.boundary) problems.push('No boundary matched')
    if (rows.length && row.crop && !['Corn', 'Cotton', 'Peanuts'].includes(row.crop)) problems.push(`No water model for ${row.crop} yet`)
    if (rows.length && row.crop && !row.plantDate) problems.push('No planting date')
    if (row.acres && shape) {
      const a = acresOf(shape.geometry)
      if (Math.abs(a - row.acres) / row.acres > 0.15) problems.push(`Boundary is ${a.toFixed(0)} ac, list says ${row.acres}`)
    }
    return { row, shape, existing: ex, problems }
  })
  const unmatchedShapes = rows.length ? shapes.filter((s) => !used.has(norm(s.name))) : []
  return {
    year, items, unmatchedShapes, found: items.length, matched: items.filter((i) => i.existing).length,
    isNew: items.filter((i) => !i.existing).length, needsLook: items.filter((i) => i.problems.length).length + unmatchedShapes.length,
  }
}

export async function applyFields(plan: FieldPlan, fileName: string, who: string): Promise<string> {
  const now = new Date().toISOString()
  await db.transaction('rw', [db.farms, db.fields, db.pivots, db.cropSeasons, db.imports], async () => {
    const farms = new Map((await db.farms.toArray()).map((f) => [norm(f.name), f]))
    const pivots = new Map((await db.pivots.toArray()).map((p) => [norm(p.name), p]))
    const farmId = async (name: string): Promise<string> => {
      const k = norm(name)
      if (!farms.has(k)) { const f: Farm = { id: uid(), name }; await db.farms.add(f); farms.set(k, f) }
      return farms.get(k)!.id
    }
    for (const it of plan.items) {
      const { row, shape } = it
      const fid = row.farm ? await farmId(row.farm) : it.existing!.farmId
      let pivotId = it.existing?.pivotId ?? null
      if (row.pivot) {
        let p = pivots.get(norm(row.pivot))
        if (!p) { p = { id: uid(), farmId: fid, name: row.pivot, profile: {} } as Pivot; await db.pivots.add(p); pivots.set(norm(row.pivot), p) }
        pivotId = p.id
      }
      const field: Field = {
        ...(it.existing ?? { id: uid() }), farmId: fid, name: it.existing?.name ?? row.name, pivotId,
        fsn: row.fsn ?? it.existing?.fsn ?? null, county: row.county ?? it.existing?.county ?? null,
        boundary: shape?.geometry ?? it.existing?.boundary ?? null,
        boundaryAcres: shape ? Math.round(acresOf(shape.geometry) * 10) / 10 : it.existing?.boundaryAcres ?? null,
      }
      await db.fields.put(field)
      if (row.crop) {
        const cs = await db.cropSeasons.where({ fieldId: field.id }).filter((c) => c.year === plan.year).first()
        const season: CropSeason = { id: cs?.id ?? uid(), fieldId: field.id, year: plan.year, crop: row.crop, acres: row.acres ?? cs?.acres ?? field.boundaryAcres ?? 0, plantDate: row.plantDate ?? cs?.plantDate ?? null }
        await db.cropSeasons.put(season)
      }
    }
    await db.imports.add({ id: uid(), kind: 'fields', fileName, at: now, who, summary: `${plan.found} fields: ${plan.matched} updated, ${plan.isNew} new, ${plan.needsLook} needed a look` })
  })
  return `${plan.found} fields saved`
}
