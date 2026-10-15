import { clientScope } from '../domain/client'
import { db, uid, type Entry, type Pivot } from '../db'
import { setProfile } from '../domain/pivot'
import { norm, pick, toNum, type Row } from './read'

// AgSense weekly CSV (the "Pivot Summary" export run for one week). Each row is one pivot's totals for
// the week, so it becomes one entry: the week's wet walking hours, spread over the week in the model.
// Pivots whose AgSense unit always reads dry count their walking hours as wet (README decision).

export interface AgPlanItem { alias: string; serial: string; pivot: Pivot | null; wetHr: number; dryHr: number; hours: number; countDry: boolean; duplicate: boolean; problems: string[] }
export interface AgPlan { from: string; to: string; items: AgPlanItem[]; found: number; matched: number; isNew: number; needsLook: number }

export const cleanAlias = (a: any) => String(a ?? '').replace(/&amp;?/g, '&').replace(/\s*&\s*/g, '&').replace(/\s+/g, ' ').trim()
export const READS_DRY = 'agsenseReadsDry'

export async function planAgSense(rows: Row[], from: string, to: string): Promise<AgPlan> {
  const pivots = (await clientScope()).pivots
  const byAlias = new Map(pivots.filter((p) => p.agsenseName).map((p) => [norm(cleanAlias(p.agsenseName)), p]))
  const bySerial = new Map(pivots.filter((p) => p.profile.agsenseSerial).map((p) => [String(p.profile.agsenseSerial.value), p]))
  const byName = new Map(pivots.map((p) => [norm(p.name), p]))
  const existing = await db.entries.where('how').equals('agsense').toArray().catch(() => [] as Entry[])
  const startAt = new Date(from + 'T00:00:00').toISOString(), stopAt = new Date(to + 'T23:59:59').toISOString()
  const items = rows.map((r) => {
    const alias = cleanAlias(pick(r, 'alias', 'pivot name', 'name'))
    const serial = String(pick(r, 'serial') ?? '').trim()
    const pivot = bySerial.get(serial) ?? byAlias.get(norm(alias)) ?? byName.get(norm(alias)) ?? null
    const wetHr = toNum(pick(r, 'wet walking hours', 'wet hours')) ?? 0
    const dryHr = toNum(pick(r, 'dry walking hours', 'dry hours')) ?? 0
    const flagged = pivot?.profile[READS_DRY]?.value === 'yes'
    const countDry = flagged || (wetHr === 0 && dryHr > 0 && !pivot?.profile[READS_DRY])
    const hours = countDry ? wetHr + dryHr : wetHr
    const problems: string[] = []
    if (!pivot) problems.push('No pivot with this AgSense name or serial')
    if (countDry && !flagged) problems.push(`Reads dry: ${dryHr.toFixed(1)} walking hours will count as wet`)
    const duplicate = !!pivot && existing.some((e) => e.pivotId === pivot.id && e.startAt === startAt && e.stopAt === stopAt)
    if (duplicate) problems.push('This week is already imported; skipped')
    return { alias, serial, pivot, wetHr, dryHr, hours, countDry, duplicate, problems }
  }).filter((i) => i.alias || i.serial)
  return { from, to, items, found: items.length, matched: items.filter((i) => i.pivot).length, isNew: 0, needsLook: items.filter((i) => i.problems.length).length }
}

export async function applyAgSense(plan: AgPlan, fileName: string, who: string): Promise<string> {
  const now = new Date().toISOString()
  const startAt = new Date(plan.from + 'T00:00:00').toISOString(), stopAt = new Date(plan.to + 'T23:59:59').toISOString()
  let n = 0
  await db.transaction('rw', [db.entries, db.pivots, db.imports], async () => {
    for (const it of plan.items) {
      if (!it.pivot || it.duplicate) continue
      const p = (await db.pivots.get(it.pivot.id))!
      if (it.serial) setProfile(p, 'agsenseSerial', it.serial, 'AgSense setting', now)
      if (it.countDry && !p.profile[READS_DRY]) setProfile(p, READS_DRY, 'yes', 'AgSense setting', now)
      await db.pivots.put(p)
      if (it.hours <= 0) continue
      await db.entries.add({
        id: uid(), pivotId: p.id, action: 'run', happenedAt: stopAt, recordedAt: now, who, how: 'agsense', startAt, stopAt, hours: it.hours,
        note: `AgSense ${plan.from} to ${plan.to}: ${it.wetHr} wet h${it.countDry ? `, ${it.dryHr} dry h counted as wet` : ''}`, synced: 0,
      })
      n++
    }
    await db.imports.add({ id: uid(), kind: 'AgSense', fileName, at: now, who, summary: `${plan.from} to ${plan.to}: ${n} pivots with run hours, ${plan.found - plan.matched} not matched` })
  })
  return `${n} AgSense runs saved`
}
