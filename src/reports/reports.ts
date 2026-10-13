import type { FarmState } from '../domain/farm'
import { farmDay } from '../domain/runs'

// Reports share one layout: the answer first, filters in plain words, a table with units in every
// header and totals at the bottom, then as-of, sources and owner. Numbers from a weaker source are marked.

export interface Filters { farm: string; crop: string; from: string; to: string }
export interface Column { key: string; label: string; num?: number } // num = decimals; omitted = text
export interface Report {
  id: string; title: string; who: string; answer: string; filters: string
  columns: Column[]; rows: Record<string, any>[]; totals: Record<string, any> | null; notes: string[]
}

export const REPORTS = [
  { id: 'season', title: 'Season water by field', who: 'You, managers, consultants' },
  { id: 'runs', title: 'Irrigation run records', who: 'NRCS, EQIP, crop insurance' },
  { id: 'pivots', title: 'Pivot health', who: 'You, dealer' },
] as const

const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

function describe(f: Filters) {
  return [f.farm ? `Farm: ${f.farm}` : 'All farms', f.crop ? `Crop: ${f.crop}` : 'all crops', `${f.from} to ${f.to}`].join(' · ')
}

export function buildReport(id: string, s: FarmState, f: Filters, owner: string): Report {
  const meta = REPORTS.find((r) => r.id === id)!
  const sources = `Runs: crew entries in Pivot Log. Rain: ${s.fields.some((x) => x.days.length) ? 'NOAA MRMS by pivot' : 'none loaded'}. ETo: ${s.weatherSource || 'none loaded'}. Model: daily water balance (FAO-56, UGA settings).`
  const base = { id, title: meta.title, who: meta.who, filters: describe(f), notes: [`As of ${s.asOf}. ${sources} Owner: ${owner || 'JA Minor Family Farms'}.`] }

  if (id === 'season') {
    const rows = s.fields
      .filter((v) => v.season && (!f.farm || v.farm?.name === f.farm) && (!f.crop || v.season.crop === f.crop))
      .map((v) => {
        const inRange = v.days.filter((d) => d.date >= f.from && d.date <= f.to)
        const rain = inRange.reduce((a, d) => a + d.rain, 0), need = inRange.reduce((a, d) => a + d.irrRecGross, 0), applied = inRange.reduce((a, d) => a + d.appliedGross, 0)
        return { farm: v.farm?.name, field: v.field.name, pivot: v.pivot?.name ?? '', crop: v.season!.crop, acres: v.season!.acres, rain, need, applied,
          pct: need > 0 ? (100 * applied) / need : null, flow: v.pivot ? (v.pivot.profile.measuredGpm ? '' : v.pivot.profile.flowGpm || v.pivot.profile.agsenseGpm ? '*' : 'no flow') : '' }
      })
    const tot = { field: 'Total (acre-weighted)', acres: sum(rows, 'acres') } as any
    for (const k of ['rain', 'need', 'applied']) tot[k] = rows.length ? rows.reduce((a, r: any) => a + r[k] * r.acres, 0) / (tot.acres || 1) : 0
    tot.pct = tot.need > 0 ? (100 * tot.applied) / tot.need : null
    const answer = !rows.length ? 'No fields match these filters.'
      : tot.applied === 0 ? `No irrigation logged yet; the model says these fields needed ${tot.need.toFixed(1)} in.`
      : `Fields got ${tot.pct!.toFixed(0)}% of the water the model says they needed (${tot.applied.toFixed(2)} of ${tot.need.toFixed(2)} in, acre-weighted).`
    return { ...base, answer, rows, totals: tot,
      columns: [{ key: 'farm', label: 'Farm' }, { key: 'field', label: 'Field' }, { key: 'pivot', label: 'Pivot' }, { key: 'crop', label: 'Crop' },
        { key: 'acres', label: 'Acres (ac)', num: 1 }, { key: 'rain', label: 'Rain (in)', num: 2 }, { key: 'need', label: 'Model need (in)', num: 2 },
        { key: 'applied', label: 'Applied (in)', num: 2 }, { key: 'pct', label: 'Applied (% of need)', num: 0 }, { key: 'flow', label: 'Flow source' }],
      notes: [...base.notes, '* Applied inches use a design or AgSense typed-in flow, not a meter.', 'Model need is the irrigation the model would have scheduled (gross, 85% efficiency).'] }
  }

  if (id === 'runs') {
    const rows = s.pivots
      .filter((p) => !f.farm || p.farm?.name === f.farm)
      .filter((p) => !f.crop || p.fields.some((fl) => s.fields.find((v) => v.field.id === fl.id)?.season?.crop === f.crop))
      .flatMap((p) => p.runs.map((r) => ({ r, p })))
      .filter(({ r }) => { const d = farmDay(r.start ?? r.stop!); return d >= f.from && d <= f.to })
      .sort((a, b) => (a.r.start ?? a.r.stop!).localeCompare(b.r.start ?? b.r.stop!))
      .map(({ r, p }) => ({
        farm: p.farm?.name, pivot: p.pivot.name, fields: p.fields.map((x) => x.name).join('; '), on: fmtTime(r.start), off: r.stop ? fmtTime(r.stop) : 'running',
        hours: r.hours, timer: r.percentTimer, direction: r.direction ?? '', around: r.madeItAround == null ? '' : r.madeItAround ? 'yes' : 'no',
        gpm: r.gpm, flowSource: r.flowSource ?? '', inches: r.inches, acreInches: r.acreInches, gallons: r.gallons,
        who: r.who.join(', '), how: r.how.join(', '), issues: r.issues.join('; '),
      }))
    const gaps = rows.filter((r) => r.issues).length
    const tot = { pivot: 'Total', hours: sum(rows, 'hours'), acreInches: sum(rows, 'acreInches'), gallons: sum(rows, 'gallons') }
    return { ...base, rows, totals: tot,
      answer: rows.length ? `${rows.length} runs, ${tot.hours.toFixed(0)} pivot-hours, ${tot.acreInches.toFixed(0)} acre-inches${gaps ? `; ${gaps} need a look` : ', no gaps'}.` : 'No runs logged in these dates.',
      columns: [{ key: 'farm', label: 'Farm' }, { key: 'pivot', label: 'Pivot' }, { key: 'fields', label: 'Fields' }, { key: 'on', label: 'On' }, { key: 'off', label: 'Off' },
        { key: 'hours', label: 'Hours (h)', num: 1 }, { key: 'timer', label: 'Timer (%)', num: 0 }, { key: 'direction', label: 'Direction' }, { key: 'around', label: 'Made it around' },
        { key: 'gpm', label: 'Flow (gpm)', num: 0 }, { key: 'flowSource', label: 'Flow source' }, { key: 'inches', label: 'Applied (in)', num: 2 },
        { key: 'acreInches', label: 'Acre-inches (ac-in)', num: 1 }, { key: 'gallons', label: 'Gallons (gal)', num: 0 }, { key: 'who', label: 'Logged by' }, { key: 'how', label: 'How' }, { key: 'issues', label: 'Needs a look' }],
      notes: [...base.notes, 'Every run is listed, gaps included. Inches = gpm x hours / (452.6 x acres). Entries are never edited; corrections are kept as separate entries.'] }
  }

  // pivot health
  const rows = s.pivots.filter((p) => !f.farm || p.farm?.name === f.farm).map((p) => {
    const miss = ['irrigatedAcres', 'hoursPerRev100'].filter((k) => !p.pivot.profile[k])
    if (!p.pivot.profile.flowGpm && !p.pivot.profile.measuredGpm && !p.pivot.profile.agsenseGpm) miss.push('flow')
    const open = p.runs.flatMap((r) => r.issues).filter((i) => !i.startsWith('No '))
    return { farm: p.farm?.name, pivot: p.pivot.name, fields: p.fields.length, acres: p.acres, agsense: p.pivot.agsenseName ? 'yes' : 'no',
      gpm: p.pivot.profile.measuredGpm?.value ?? p.pivot.profile.flowGpm?.value ?? p.pivot.profile.agsenseGpm?.value ?? null,
      flowSource: p.pivot.profile.measuredGpm ? 'measured' : p.pivot.profile.flowGpm?.source ?? p.pivot.profile.agsenseGpm?.source ?? '',
      missing: miss.map((m) => ({ irrigatedAcres: 'acres', hoursPerRev100: 'hours per rev' } as any)[m] ?? m).join(', '),
      runs: p.runs.length, issues: open.join('; ') }
  })
  const bad = rows.filter((r) => r.missing).length
  return { ...base, rows, totals: null,
    answer: `${rows.length - bad} of ${rows.length} pivots have what the model needs${bad ? `; ${bad} are missing acres, flow or hours per rev` : ''}.`,
    columns: [{ key: 'farm', label: 'Farm' }, { key: 'pivot', label: 'Pivot' }, { key: 'fields', label: 'Fields (#)', num: 0 }, { key: 'acres', label: 'Acres (ac)', num: 1 },
      { key: 'agsense', label: 'On AgSense' }, { key: 'gpm', label: 'Flow (gpm)', num: 0 }, { key: 'flowSource', label: 'Flow source' }, { key: 'missing', label: 'Missing' },
      { key: 'runs', label: 'Runs (#)', num: 0 }, { key: 'issues', label: 'Open issues' }] }
}

/** CSV with plain column names and one row per record, so another program can use it without cleanup. */
export function toCSV(r: Report): string {
  const esc = (v: any) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const val = (c: Column, v: any) => (c.num !== undefined && typeof v === 'number' ? v.toFixed(c.num) : v)
  const lines = [r.columns.map((c) => esc(c.label)).join(',')]
  for (const row of r.rows) lines.push(r.columns.map((c) => esc(val(c, row[c.key]))).join(','))
  return lines.join('\r\n') + '\r\n'
}
