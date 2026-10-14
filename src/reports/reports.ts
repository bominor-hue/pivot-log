import type { FarmState } from '../domain/farm'
import { farmDay } from '../domain/runs'

// Reports share one layout: the answer first, filters in plain words, a table with units in every
// header and totals at the bottom, then as-of, sources and owner. Numbers from a weaker source are marked.

export interface Filters { farm: string; crop: string; from: string; to: string }
/** num = decimals (omitted = text). total: 'sum' adds up; 'acres' is an acre-weighted average. */
export interface Column { key: string; label: string; num?: number; total?: 'sum' | 'acres' }
export interface Report {
  id: string; title: string; who: string; answer: string; filters: string
  columns: Column[]; rows: Record<string, any>[]; totals: Record<string, any> | null; notes: string[]
}
export interface View { columns?: string[]; group?: string } // picked columns (in order) and group-by column

export const REPORTS = [
  { id: 'season', title: 'Season water by field', who: 'You, managers, consultants' },
  { id: 'weekly', title: 'Weekly applied vs recommended', who: 'You, managers' },
  { id: 'runs', title: 'Irrigation run records', who: 'NRCS, EQIP, crop insurance' },
  { id: 'source', title: 'Water use by source', who: 'GA EPD permits, state ag water meters' },
  { id: 'acres', title: 'Irrigated acres and crops', who: 'FSA, insurance agent' },
  { id: 'pivots', title: 'Pivot health', who: 'You, dealer' },
] as const

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const weekStart = (d: string) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10) }
const pv = (p: any, k: string) => p.profile[k]?.value ?? ''

export function totalsFor(columns: Column[], rows: Record<string, any>[], label = 'Total'): Record<string, any> {
  const t: Record<string, any> = {}
  const acres = rows.reduce((a, r) => a + (Number(r.acres) || 0), 0)
  for (const c of columns) {
    if (c.total === 'sum') t[c.key] = rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0)
    if (c.total === 'acres') t[c.key] = acres ? rows.reduce((a, r) => a + (Number(r[c.key]) || 0) * (Number(r.acres) || 0), 0) / acres : null
  }
  const first = columns.find((c) => c.num === undefined)
  if (first) t[first.key] = label
  return t
}

export function buildReport(id: string, s: FarmState, f: Filters, owner: string): Report {
  const meta = REPORTS.find((r) => r.id === id) ?? REPORTS[0]
  const filters = [f.farm ? `Farm: ${f.farm}` : 'All farms', f.crop ? `crop: ${f.crop}` : 'all crops', `${f.from} to ${f.to}`].join(' · ')
  const sources = `Runs: Pivot Log entries and AgSense weekly exports. Rain: NOAA MRMS by pivot. ET: ${s.weatherSource || 'none loaded'}. Model: daily water balance (FAO-56, UGA settings).`
  const notes = [`As of ${s.asOf}. ${sources} Owner: ${owner || 'JA Minor Family Farms'}.`]
  const fieldsIn = s.fields.filter((v) => v.season && (!f.farm || v.farm?.name === f.farm) && (!f.crop || v.season.crop === f.crop))
  const pivotsIn = s.pivots.filter((p) => (!f.farm || p.farm?.name === f.farm) && (!f.crop || p.fields.some((fl) => s.fields.find((v) => v.field.id === fl.id)?.season?.crop === f.crop)))
  const runsIn = pivotsIn.flatMap((p) => p.runs.map((r) => ({ r, p }))).filter(({ r }) => { const d = farmDay(r.start ?? r.stop!); return d >= f.from && d <= f.to })
    .sort((a, b) => (a.r.start ?? a.r.stop!).localeCompare(b.r.start ?? b.r.stop!))
  const weak = (src: string | null) => (src && src !== 'measured' ? '*' : '')
  const out = (columns: Column[], rows: Record<string, any>[], answer: string, more: string[] = [], totals = true): Report =>
    ({ id: meta.id, title: meta.title, who: meta.who, filters, columns, rows, totals: totals && rows.length ? totalsFor(columns, rows) : null, answer, notes: [...notes, ...more] })

  if (meta.id === 'season') {
    const rows = fieldsIn.map((v) => {
      const d = v.days.filter((x) => x.date >= f.from && x.date <= f.to)
      const rain = d.reduce((a, x) => a + (x.rain >= 0.1 ? x.rain : 0), 0), need = d.reduce((a, x) => a + x.irrRecGross, 0), applied = d.reduce((a, x) => a + x.appliedGross, 0)
      return { farm: v.farm?.name, field: v.field.name, pivot: v.pivot?.name ?? '', crop: v.season!.crop, acres: v.season!.acres, rain, need, applied,
        pct: need > 0 ? (100 * applied) / need : null, flow: v.pivot ? (v.pivot.profile.measuredGpm ? 'measured' : v.pivot.profile.flowGpm ? 'design*' : v.pivot.profile.agsenseGpm ? 'AgSense setting*' : 'no flow') : '' }
    })
    const columns: Column[] = [{ key: 'farm', label: 'Farm' }, { key: 'field', label: 'Field' }, { key: 'pivot', label: 'Pivot' }, { key: 'crop', label: 'Crop' },
      { key: 'acres', label: 'Acres (ac)', num: 1, total: 'sum' }, { key: 'rain', label: 'Rain (in)', num: 2, total: 'acres' }, { key: 'need', label: 'Model need (in)', num: 2, total: 'acres' },
      { key: 'applied', label: 'Applied (in)', num: 2, total: 'acres' }, { key: 'pct', label: 'Applied (% of need)', num: 0 }, { key: 'flow', label: 'Flow source' }]
    const t = totalsFor(columns, rows)
    const pct = t.need > 0 ? (100 * t.applied) / t.need : null
    const answer = !rows.length ? 'No fields match these filters.' : !t.applied ? `No irrigation logged yet; the model says these fields needed ${t.need.toFixed(1)} in.`
      : `Fields got ${pct!.toFixed(0)}% of the water the model says they needed (${t.applied.toFixed(2)} of ${t.need.toFixed(2)} in, acre-weighted).`
    const r = out(columns, rows, answer, ['* Applied inches use a design or AgSense typed-in flow, not a meter.', 'Model need is what the model would have scheduled (gross, 85% efficiency).'])
    if (r.totals) r.totals.pct = pct
    return r
  }

  if (meta.id === 'weekly') {
    const byKey = new Map<string, any>()
    for (const v of fieldsIn) {
      if (!v.pivot) continue
      for (const d of v.days) {
        if (d.date < f.from || d.date > f.to) continue
        const wk = weekStart(d.date), key = v.pivot.id + wk
        const row = byKey.get(key) ?? byKey.set(key, { week: wk, farm: v.farm?.name, pivot: v.pivot.name, crops: new Set(), acres: 0, _fields: new Set(), rain: 0, need: 0, applied: 0, _a: 0 }).get(key)
        if (!row._fields.has(v.field.id)) { row._fields.add(v.field.id); row.acres += v.season!.acres }
        row.crops.add(v.season!.crop)
        const a = v.season!.acres
        row.rain += (d.rain >= 0.1 ? d.rain : 0) * a; row.need += d.irrRecGross * a; row.applied += d.appliedGross * a
      }
    }
    const rows = [...byKey.values()].map((r) => {
      const rain = r.rain / r.acres, need = r.need / r.acres, applied = r.applied / r.acres
      return { week: r.week, farm: r.farm, pivot: r.pivot, crops: [...r.crops].join('/'), acres: r.acres, rain, need, applied, diff: applied - need,
        flag: need > 0.05 && applied < 0.01 ? 'Model said water; none logged' : applied > need + 0.5 ? 'Well over' : '' }
    }).sort((a, b) => a.week.localeCompare(b.week) || a.pivot.localeCompare(b.pivot, undefined, { numeric: true }))
    const missed = rows.filter((r) => r.flag.startsWith('Model')).length
    return out([{ key: 'week', label: 'Week of' }, { key: 'farm', label: 'Farm' }, { key: 'pivot', label: 'Pivot' }, { key: 'crops', label: 'Crops' }, { key: 'acres', label: 'Acres (ac)', num: 1 },
      { key: 'rain', label: 'Rain (in)', num: 2 }, { key: 'need', label: 'Recommended (in)', num: 2, total: 'sum' }, { key: 'applied', label: 'Applied (in)', num: 2, total: 'sum' },
      { key: 'diff', label: 'Over (+) or under (in)', num: 2, total: 'sum' }, { key: 'flag', label: 'Flag' }], rows,
      rows.length ? `${rows.length} pivot-weeks; ${missed} weeks the model said to water and nothing was logged.` : 'No weeks in these dates.',
      ['Each row is one pivot for one week (Monday start). Inches are acre-weighted across the pivot\'s fields.'], false)
  }

  if (meta.id === 'runs') {
    const rows = runsIn.map(({ r, p }) => ({
      farm: p.farm?.name, pivot: p.pivot.name, fields: p.fields.map((x) => x.name).join('; '), on: r.periodHours != null ? `week of ${farmDay(r.start!)}` : fmtTime(r.start), off: r.stop ? fmtTime(r.stop) : 'running',
      hours: r.hours, timer: r.percentTimer, direction: r.direction ?? '', around: r.madeItAround == null ? '' : r.madeItAround ? 'yes' : 'no',
      gpm: r.gpm, flowSource: (r.flowSource ?? '') + weak(r.flowSource), inches: r.inches, acreInches: r.acreInches, gallons: r.gallons,
      who: r.who.join(', '), how: r.how.join(', '), issues: r.issues.join('; '),
    }))
    const gaps = rows.filter((r) => r.issues).length
    const columns: Column[] = [{ key: 'farm', label: 'Farm' }, { key: 'pivot', label: 'Pivot' }, { key: 'fields', label: 'Fields' }, { key: 'on', label: 'On' }, { key: 'off', label: 'Off' },
      { key: 'hours', label: 'Hours (h)', num: 1, total: 'sum' }, { key: 'timer', label: 'Timer (%)', num: 0 }, { key: 'direction', label: 'Direction' }, { key: 'around', label: 'Made it around' },
      { key: 'gpm', label: 'Flow (gpm)', num: 0 }, { key: 'flowSource', label: 'Flow source' }, { key: 'inches', label: 'Applied (in)', num: 2 },
      { key: 'acreInches', label: 'Acre-inches (ac-in)', num: 1, total: 'sum' }, { key: 'gallons', label: 'Gallons (gal)', num: 0, total: 'sum' }, { key: 'who', label: 'Logged by' }, { key: 'how', label: 'How' }, { key: 'issues', label: 'Needs a look' }]
    const t = totalsFor(columns, rows)
    return out(columns, rows, rows.length ? `${rows.length} runs, ${t.hours.toFixed(0)} pivot-hours, ${t.acreInches.toFixed(0)} acre-inches${gaps ? `; ${gaps} need a look` : ', no gaps'}.` : 'No runs logged in these dates.',
      ['Every run is listed, gaps included. Inches = gpm × hours ÷ (452.6 × acres). * Flow is a design or AgSense setting, not a meter. AgSense weekly totals show the week, not run times. Entries are never edited; corrections are kept as separate entries.'])
  }

  if (meta.id === 'source') {
    const by = new Map<string, any>()
    for (const { r, p } of runsIn) {
      if (r.gallons == null) continue
      const src = pv(p.pivot, 'waterSource') || pv(p.pivot, 'wellId') || `(no source on ${p.pivot.name})`
      const month = farmDay(r.stop ?? r.start!).slice(0, 7), key = src + month
      const row = by.get(key) ?? by.set(key, { source: src, well: pv(p.pivot, 'wellId'), permit: pv(p.pivot, 'epdPermit'), meter: pv(p.pivot, 'stateMeterId'), month, pivots: new Set(), gallons: 0, acreInches: 0, weak: false }).get(key)
      row.pivots.add(p.pivot.name); row.gallons += r.gallons; row.acreInches += r.acreInches ?? 0; if (r.flowSource !== 'measured') row.weak = true
    }
    const rows = [...by.values()].map((r) => ({ ...r, pivots: [...r.pivots].join(', '), basis: r.weak ? 'hours × flow*' : 'measured flow' })).sort((a, b) => a.source.localeCompare(b.source) || a.month.localeCompare(b.month))
    const columns: Column[] = [{ key: 'source', label: 'Water source' }, { key: 'well', label: 'Well / intake ID' }, { key: 'permit', label: 'EPD permit #' }, { key: 'meter', label: 'State meter ID' },
      { key: 'month', label: 'Month' }, { key: 'pivots', label: 'Pivots' }, { key: 'gallons', label: 'Gallons (gal)', num: 0, total: 'sum' }, { key: 'acreInches', label: 'Acre-inches (ac-in)', num: 1, total: 'sum' }, { key: 'basis', label: 'Basis' }]
    const t = totalsFor(columns, rows)
    return out(columns, rows, rows.length ? `${(t.gallons / 1e6).toFixed(1)} million gallons (${(t.acreInches / 12).toFixed(0)} acre-feet) from ${new Set(rows.map((r) => r.source)).size} sources.` : 'No runs with a flow rate in these dates.',
      ['* Gallons are run hours × flow on the pivot profile, not a meter reading. Sources, permits and meter IDs come from the pivot info sheet.'])
  }

  if (meta.id === 'acres') {
    const rows = fieldsIn.map((v) => ({ farm: v.farm?.name, field: v.field.name, fsn: v.field.fsn ?? '', tract: v.pivot ? pv(v.pivot, 'tractClu') : '', county: v.field.county ?? '', crop: v.season!.crop,
      plant: v.season!.plantDate ?? '', acres: v.season!.acres, pivot: v.pivot?.name ?? '', irrigated: v.pivot ? 'Irrigated' : 'Dryland' }))
    const columns: Column[] = [{ key: 'farm', label: 'Farm' }, { key: 'field', label: 'Field' }, { key: 'fsn', label: 'FSN' }, { key: 'tract', label: 'Tract / CLU' }, { key: 'county', label: 'County' },
      { key: 'crop', label: 'Crop' }, { key: 'plant', label: 'Planted' }, { key: 'acres', label: 'Acres (ac)', num: 1, total: 'sum' }, { key: 'pivot', label: 'Pivot' }, { key: 'irrigated', label: 'Practice' }]
    const byCrop = [...new Set(rows.map((r) => r.crop))].map((c) => `${rows.filter((r) => r.crop === c).reduce((a, r) => a + r.acres, 0).toFixed(0)} ac ${c.toLowerCase()}`)
    return out(columns, rows, rows.length ? `${rows.reduce((a, r) => a + r.acres, 0).toFixed(0)} irrigated acres: ${byCrop.join(', ')}.` : 'No fields match these filters.', ['Acres are the crop plan acres for the year.'])
  }

  const rows = pivotsIn.map((p) => {
    const miss = ['irrigatedAcres'].filter((k) => !p.pivot.profile[k]).map(() => 'acres')
    if (!p.pivot.profile.flowGpm && !p.pivot.profile.measuredGpm && !p.pivot.profile.agsenseGpm) miss.push('flow')
    if (!p.lapHours100) miss.push('hours per lap')
    const open = p.runs.flatMap((r) => r.issues).filter((i) => !i.startsWith('No '))
    const last = p.runs.filter((r) => r.stop).at(-1)
    return { farm: p.farm?.name, pivot: p.pivot.name, fields: p.fields.length, acres: p.acres, agsense: p.pivot.agsenseName ? (pv(p.pivot, 'agsenseReadsDry') ? 'yes, reads dry' : 'yes') : 'no',
      gpm: pv(p.pivot, 'measuredGpm') || pv(p.pivot, 'flowGpm') || pv(p.pivot, 'agsenseGpm') || null,
      flowSource: p.pivot.profile.measuredGpm ? 'measured' : p.pivot.profile.flowGpm?.source ?? p.pivot.profile.agsenseGpm?.source ?? '',
      lap: p.lapHours100?.hours ?? null, lapSource: p.lapHours100?.source ?? '', missing: miss.join(', '), runs: p.runs.length, lastRun: last ? farmDay(last.stop!) : '', issues: open.join('; ') }
  })
  const bad = rows.filter((r) => r.missing).length
  return out([{ key: 'farm', label: 'Farm' }, { key: 'pivot', label: 'Pivot' }, { key: 'fields', label: 'Fields (#)', num: 0 }, { key: 'acres', label: 'Acres (ac)', num: 1 },
    { key: 'agsense', label: 'On AgSense' }, { key: 'gpm', label: 'Flow (gpm)', num: 0 }, { key: 'flowSource', label: 'Flow source' }, { key: 'lap', label: 'Hours per lap at 100% (h)', num: 1 },
    { key: 'lapSource', label: 'Lap source' }, { key: 'missing', label: 'Missing' }, { key: 'runs', label: 'Runs (#)', num: 0 }, { key: 'lastRun', label: 'Last run' }, { key: 'issues', label: 'Open issues' }], rows,
    `${rows.length - bad} of ${rows.length} pivots have what the model needs${bad ? `; ${bad} are missing acres, flow or lap time` : ''}.`, [], false)
}

/** Apply a saved view: pick and order columns, and group rows with a subtotal under each group. */
export function applyView(r: Report, v: View): Report {
  const columns = v.columns?.length ? v.columns.map((k) => r.columns.find((c) => c.key === k)).filter(Boolean) as Column[] : r.columns
  if (!v.group || !r.columns.some((c) => c.key === v.group)) return { ...r, columns }
  const groups = new Map<string, Record<string, any>[]>()
  for (const row of r.rows) { const g = String(row[v.group] ?? ''); groups.set(g, [...(groups.get(g) ?? []), row]) }
  const rows: Record<string, any>[] = []
  for (const [g, rs] of [...groups].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    rows.push(...rs)
    if (r.columns.some((c) => c.total)) rows.push({ ...totalsFor(r.columns, rs, `${g} subtotal`), [v.group]: `${g} subtotal`, _sub: true })
  }
  return { ...r, columns, rows }
}

/** CSV with plain column names and one row per record, so another program can use it without cleanup. */
export function toCSV(r: Report): string {
  const esc = (v: any) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const val = (c: Column, v: any) => (c.num !== undefined && typeof v === 'number' ? v.toFixed(c.num) : v)
  const lines = [r.columns.map((c) => esc(c.label)).join(',')]
  for (const row of r.rows) if (!row._sub) lines.push(r.columns.map((c) => esc(val(c, row[c.key]))).join(','))
  return lines.join('\r\n') + '\r\n'
}

/** Excel: one tidy table, plus a Notes sheet with the answer, filters, sources and units. */
export async function toXlsx(r: Report): Promise<Blob> {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const round = (c: Column, v: any) => (c.num !== undefined && typeof v === 'number' ? Number(v.toFixed(c.num)) : v ?? null)
  const data = [r.columns.map((c) => ({ value: c.label, fontWeight: 'bold' as const })), ...r.rows.filter((x) => !x._sub).map((row) => r.columns.map((c) => round(c, row[c.key])))]
  if (r.totals) data.push(r.columns.map((c) => round(c, r.totals![c.key])))
  const notes = [[r.title], [r.answer], [r.filters], [], ...r.notes.map((n) => [n])]
  return (writeExcelFile as any)([{ data, sheet: 'Report', stickyRowsCount: 1 }, { data: notes, sheet: 'Notes' }]).toBlob()
}
