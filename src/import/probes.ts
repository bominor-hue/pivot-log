import { db, uid } from '../db'
import { norm, pick, toDate, toNum, type Row } from './read'

// Probe readings from the 2-3 check sites: CSV with date, field, and either % of available water used
// or % full (most probe exports show "% full"; it is converted to % used to sit on the model's scale).
export async function importProbes(rows: Row[], fileName: string, who: string): Promise<string> {
  const fields = new Map((await db.fields.toArray()).map((f) => [norm(f.name), f.id]))
  let n = 0, skipped = 0
  const out = []
  for (const r of rows) {
    const date = toDate(pick(r, 'date', 'day'))
    const fieldId = fields.get(norm(pick(r, 'field', 'site', 'field name')))
    const used = toNum(pick(r, 'pct_used', '% used', 'percent used'))
    const full = toNum(pick(r, 'pct_full', '% full', 'percent full', 'paw', 'available water'))
    const pctUsed = used ?? (full !== null ? 100 - full : null)
    if (!date || !fieldId || pctUsed === null) { skipped++; continue }
    out.push({ id: `${fieldId}:${date}`, fieldId, date, pctUsed, source: fileName })
    n++
  }
  await db.probes.bulkPut(out)
  await db.imports.add({ id: uid(), kind: 'probes', fileName, at: new Date().toISOString(), who, summary: `${n} readings, ${skipped} rows skipped` })
  return `${n} probe readings saved${skipped ? `, ${skipped} rows skipped (no date, field or reading)` : ''}`
}
