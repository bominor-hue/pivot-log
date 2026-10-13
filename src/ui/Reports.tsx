import { useMemo, useState } from 'react'
import { buildReport, REPORTS, toCSV, type Filters } from '../reports/reports'
import { useNav } from './common'

// The one-file preview runs in a sandbox that blocks downloads and printing.
const PREVIEW = import.meta.env.MODE === 'single'

function download(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function Reports() {
  const { state, me, toast } = useNav()
  const [id, setId] = useState<string>('season')
  const [f, setF] = useState<Filters>({ farm: '', crop: '', from: `${state.year}-01-01`, to: state.asOf })
  const r = useMemo(() => buildReport(id, state, f, me), [id, state, f, me])
  const crops = [...new Set(state.fields.map((v) => v.season?.crop).filter(Boolean))] as string[]
  const cell = (c: { num?: number }, v: any) => (v === null || v === undefined || v === '' ? '' : c.num !== undefined && typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: c.num, maximumFractionDigits: c.num }) : String(v))
  return (
    <div className="page wide">
      <h1 className="lt">Reports</h1>
      <p className="sub">Pick a report, filter it, and export. Every report has the same layout.</p>
      <div className="filters">
        <select value={id} onChange={(e) => setId(e.target.value)}>{REPORTS.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
        <select value={f.farm} onChange={(e) => setF({ ...f, farm: e.target.value })}><option value="">All farms</option>{state.farms.map((x) => <option key={x.id}>{x.name}</option>)}</select>
        <select value={f.crop} onChange={(e) => setF({ ...f, crop: e.target.value })}><option value="">All crops</option>{crops.map((c) => <option key={c}>{c}</option>)}</select>
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From" />
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To" />
        {PREVIEW
          ? <button className="btn pri" onClick={() => navigator.clipboard.writeText(toCSV(r)).then(() => toast('CSV copied; paste it into Excel'), () => toast('Copy did not work here'))}>Copy CSV</button>
          : <button className="btn pri" onClick={() => download(`${r.id}_${f.from}_${f.to}.csv`, toCSV(r))}>Export CSV</button>}
        {!PREVIEW && <button className="btn" onClick={() => window.print()}>Print or PDF</button>}
      </div>
      <div className="rep">
        <div className="note" style={{ margin: '0 0 6px' }}>{r.title} · for {r.who}</div>
        <p className="ans">{r.answer}</p>
        <p className="flt">{r.filters}</p>
        <div className="tbl"><table>
          <thead><tr>{r.columns.map((c) => <th key={c.key} className={c.num !== undefined ? 'n' : ''}>{c.label}</th>)}</tr></thead>
          <tbody>{r.rows.map((row, i) => <tr key={i}>{r.columns.map((c) => <td key={c.key} className={c.num !== undefined ? 'n' : ''}>{cell(c, row[c.key])}</td>)}</tr>)}</tbody>
          {r.totals && <tfoot><tr>{r.columns.map((c) => <td key={c.key} className={c.num !== undefined ? 'n' : ''}>{cell(c, r.totals![c.key])}</td>)}</tr></tfoot>}
        </table></div>
        {r.notes.map((n, i) => <p key={i} className="foot" style={{ margin: '10px 0 0' }}>{n}</p>)}
      </div>
    </div>
  )
}
