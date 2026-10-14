import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { db, setSetting } from '../db'
import { applyView, buildReport, REPORTS, toCSV, toXlsx, type Filters, type View } from '../reports/reports'
import { useNav } from './common'

// The one-file preview runs in a sandbox that blocks downloads and printing.
const PREVIEW = import.meta.env.MODE === 'single'

interface Saved { name: string; id: string; filters: Omit<Filters, 'from' | 'to'>; view: View }

function download(name: string, blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function Reports() {
  const { state, me, toast } = useNav()
  const [id, setId] = useState<string>('season')
  const [f, setF] = useState<Filters>({ farm: '', crop: '', from: `${state.year}-01-01`, to: state.asOf })
  const [view, setView] = useState<View>({})
  const [adjust, setAdjust] = useState(false)
  const saved = (useLiveQuery(() => db.settings.get('savedReports'), [])?.value ?? []) as Saved[]
  const full = useMemo(() => buildReport(id, state, f, me), [id, state, f, me])
  const r = useMemo(() => applyView(full, view), [full, view])
  const crops = [...new Set(state.fields.map((v) => v.season?.crop).filter(Boolean))] as string[]
  const cell = (c: { num?: number }, v: any) => (v === null || v === undefined || v === '' ? '' : c.num !== undefined && typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: c.num, maximumFractionDigits: c.num }) : String(v))
  const shown = view.columns?.length ? view.columns : full.columns.map((c) => c.key)
  const toggle = (k: string) => setView({ ...view, columns: shown.includes(k) ? shown.filter((x) => x !== k) : full.columns.map((c) => c.key).filter((x) => x === k || shown.includes(x)) })
  const fileBase = `${r.id}_${f.from}_${f.to}`

  async function save() {
    const name = `${REPORTS.find((x) => x.id === id)!.title}${f.farm ? `, ${f.farm}` : ''}${f.crop ? `, ${f.crop}` : ''}${view.group ? `, by ${full.columns.find((c) => c.key === view.group)?.label.toLowerCase()}` : ''}`
    await setSetting('savedReports', [...saved.filter((s) => s.name !== name), { name, id, filters: { farm: f.farm, crop: f.crop }, view }])
    toast('Saved to My reports')
  }
  return (
    <div className="page wide">
      <h1 className="lt">Reports</h1>
      <p className="sub">Pick a report, filter it, and export it. Every report has the same layout.</p>
      {saved.length > 0 && <div className="filters">{saved.map((s) => (
        <span key={s.name} className="chipbtn">
          <button onClick={() => { setId(s.id); setF({ ...f, ...s.filters }); setView(s.view) }}>{s.name}</button>
          <button aria-label={`Remove ${s.name}`} onClick={() => setSetting('savedReports', saved.filter((x) => x.name !== s.name))}>×</button>
        </span>))}</div>}
      <div className="filters">
        <select id="rep-kind" value={id} onChange={(e) => { setId(e.target.value); setView({}) }} aria-label="Report">{REPORTS.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
        <select id="rep-farm" value={f.farm} onChange={(e) => setF({ ...f, farm: e.target.value })} aria-label="Farm"><option value="">All farms</option>{state.farms.map((x) => <option key={x.id}>{x.name}</option>)}</select>
        <select id="rep-crop" value={f.crop} onChange={(e) => setF({ ...f, crop: e.target.value })} aria-label="Crop"><option value="">All crops</option>{crops.map((c) => <option key={c}>{c}</option>)}</select>
        <input id="rep-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From" />
        <input id="rep-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To" />
        <button className="btn" onClick={() => setAdjust(!adjust)}>{adjust ? 'Done' : 'Columns and groups'}</button>
        <button className="btn" onClick={save}>Save</button>
      </div>
      {adjust && <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div className="filters" style={{ margin: 0 }}>
          <label className="note" style={{ margin: 0, alignSelf: 'center' }}>Group by</label>
          <select id="rep-group" value={view.group ?? ''} onChange={(e) => setView({ ...view, group: e.target.value || undefined })}>
            <option value="">No groups</option>{full.columns.filter((c) => c.num === undefined).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div className="filters" style={{ margin: '10px 0 0' }}>{full.columns.map((c) => (
          <label key={c.key} className="chk"><input type="checkbox" checked={shown.includes(c.key)} onChange={() => toggle(c.key)} />{c.label}</label>))}
        </div>
      </div>}
      <div className="filters">
        {PREVIEW
          ? <button className="btn pri" onClick={() => navigator.clipboard.writeText(toCSV(r)).then(() => toast('CSV copied; paste it into Excel'), () => toast('Copy did not work here'))}>Copy CSV</button>
          : <>
            <button className="btn pri" onClick={async () => download(`${fileBase}.xlsx`, await toXlsx(r))}>Excel</button>
            <button className="btn" onClick={() => download(`${fileBase}.csv`, new Blob([toCSV(r)], { type: 'text/csv;charset=utf-8' }))}>CSV</button>
            <button className="btn" onClick={() => window.print()}>PDF (print)</button>
          </>}
      </div>
      <div className="rep">
        <div className="note" style={{ margin: '0 0 6px' }}>{r.title} · for {r.who}</div>
        <p className="ans">{r.answer}</p>
        <p className="flt">{r.filters}{view.group ? ` · grouped by ${full.columns.find((c) => c.key === view.group)?.label.toLowerCase()}` : ''}</p>
        <div className="tbl"><table>
          <thead><tr>{r.columns.map((c) => <th key={c.key} className={c.num !== undefined ? 'n' : ''}>{c.label}</th>)}</tr></thead>
          <tbody>{r.rows.map((row, i) => <tr key={i} className={row._sub ? 'sub' : ''}>{r.columns.map((c) => <td key={c.key} className={c.num !== undefined ? 'n' : ''}>{cell(c, row[c.key])}</td>)}</tr>)}</tbody>
          {r.totals && <tfoot><tr>{r.columns.map((c) => <td key={c.key} className={c.num !== undefined ? 'n' : ''}>{cell(c, r.totals![c.key])}</td>)}</tr></tfoot>}
        </table></div>
        {r.notes.map((n, i) => <p key={i} className="foot" style={{ margin: '10px 0 0' }}>{n}</p>)}
      </div>
    </div>
  )
}
