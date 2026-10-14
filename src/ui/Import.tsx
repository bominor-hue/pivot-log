import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, setSetting } from '../db'
import { clearAll, loadDemo } from '../domain/farm'
import { readBoundaries, type Shape } from '../import/boundaries'
import { applyFields, parseFieldRows, planFields, type FieldPlan } from '../import/fields'
import { applyPivotInfo, isPivotInfoHeader, planPivotInfo, type PivotPlan } from '../import/pivotInfo'
import { readTable } from '../import/read'
import { importWeather } from '../import/weather'
import { applyAgSense, planAgSense, type AgPlan } from '../import/agsense'
import { importProbes } from '../import/probes'
import { supabase, pushEntries } from '../sync'
import { useNav } from './common'
import { People } from './SignIn'

function Counts({ found, matched, isNew, needsLook }: { found: number; matched: number; isNew: number; needsLook: number }) {
  return <div className="tiles" style={{ marginTop: 10 }}>
    <div className="tile"><b>{found}</b><span>Found</span></div>
    <div className="tile"><b style={{ color: 'var(--leaf)' }}>{matched}</b><span>Matched{isNew ? ` · ${isNew} new` : ''}</span></div>
    <div className="tile"><b style={{ color: needsLook ? 'var(--amber)' : 'var(--fg3)' }}>{needsLook}</b><span>Need a look</span></div>
  </div>
}

export function ImportScreen() {
  const { me, toast, state } = useNav()
  const [year, setYear] = useState(state.year)
  const [listFile, setListFile] = useState<File | null>(null)
  const [shapeFile, setShapeFile] = useState<File | null>(null)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [fplan, setFplan] = useState<FieldPlan | null>(null)
  const [pfile, setPfile] = useState<File | null>(null)
  const [pplan, setPplan] = useState<PivotPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [agFrom, setAgFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
  const [agTo, setAgTo] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 10))
  const [agFile, setAgFile] = useState<File | null>(null)
  const [agPlan, setAgPlan] = useState<AgPlan | null>(null)
  const [err, setErr] = useState('')
  const imports = useLiveQuery(() => db.imports.orderBy('at').reverse().limit(10).toArray(), [], [])

  async function previewFields(list = listFile, shp = shapeFile) {
    setErr(''); setFplan(null)
    try {
      const rows = list ? parseFieldRows(await readTable(list)) : []
      const sh = shp ? await readBoundaries(shp) : []
      setShapes(sh)
      if (!rows.length && !sh.length) return
      setFplan(await planFields(rows, sh, year))
    } catch (e: any) { setErr(e.message ?? String(e)) }
  }
  async function previewPivots(file: File) {
    setErr(''); setPplan(null)
    try {
      const rows = await readTable(file, { sheet: file.name.toLowerCase().endsWith('.csv') ? undefined : 'Fill in', headerMatch: isPivotInfoHeader })
      setPplan(await planPivotInfo(rows))
    } catch (e: any) { setErr(`Could not read the "Fill in" tab: ${e.message ?? e}`) }
  }
  const run = async (fn: () => Promise<string>) => { setBusy(true); try { toast(await fn()) } catch (e: any) { setErr(e.message ?? String(e)) } finally { setBusy(false) } }

  return (
    <div className="page">
      <h1 className="lt">Import</h1>
      <p className="sub">Nothing is saved until you press Import. Re-importing updates in place; it never makes duplicates.</p>
      {err && <p className="calc warn">{err}</p>}

      <div className="sec">1. Fields, boundaries and crop plan</div>
      <div className="card form">
        <div className="row"><label>Field list<br /><span className="note" style={{ margin: 0 }}>Field Master or crop plan, Excel or CSV: farm, field, pivot, crop, acres, plant date</span></label>
          <input type="file" accept=".csv,.xlsx,.xlsm" onChange={(e) => { const f = e.target.files?.[0] ?? null; setListFile(f); previewFields(f, shapeFile) }} /></div>
        <div className="row"><label>Boundaries<br /><span className="note" style={{ margin: 0 }}>Shapefile (.zip), KML, KMZ or GeoJSON</span></label>
          <input type="file" accept=".zip,.kml,.kmz,.geojson,.json" onChange={(e) => { const f = e.target.files?.[0] ?? null; setShapeFile(f); previewFields(listFile, f) }} /></div>
        <div className="row"><label>Crop year</label><input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 90 }} /></div>
      </div>
      {fplan && <>
        <Counts {...fplan} />
        {(fplan.items.some((i) => i.problems.length) || fplan.unmatchedShapes.length > 0) && <div className="card" style={{ marginTop: 10 }}>
          {fplan.items.filter((i) => i.problems.length).slice(0, 25).map((i) => <div key={i.row.name} className="row"><span className="dot d-soon" /><span className="t"><b>{i.row.name}</b><span>{i.problems.join('; ')}</span></span></div>)}
          {fplan.unmatchedShapes.slice(0, 10).map((s, k) => <div key={'u' + k} className="row"><span className="dot d-none" /><span className="t"><b>{s.name || '(no name)'}</b><span>Boundary with no field in the list; not imported</span></span></div>)}
        </div>}
        <button className="cta" disabled={busy} onClick={() => run(async () => { const m = await applyFields(fplan, [listFile?.name, shapeFile?.name].filter(Boolean).join(' + '), me); setFplan(null); return m })}>Import {fplan.found} fields</button>
      </>}
      {!fplan && shapes.length > 0 && <p className="note">{shapes.length} boundaries read.</p>}

      <div className="sec">2. Pivot info sheet</div>
      <div className="card form">
        <div className="row"><label>Pivot info workbook<br /><span className="note" style={{ margin: 0 }}>The "Fill in" tab, one row per pivot</span></label>
          <input type="file" accept=".xlsx,.csv" onChange={(e) => { const f = e.target.files?.[0] ?? null; setPfile(f); if (f) previewPivots(f) }} /></div>
        <a className="row" href="./templates/pivot_info_sheet_template.xlsx" download style={{ color: 'var(--water)', textDecoration: 'none' }}><span className="t"><b style={{ color: 'var(--water)' }}>Download a blank template</b><span>Same columns on every farm</span></span></a>
      </div>
      {pplan && <>
        <Counts {...pplan} />
        <p className="note">{pplan.filledCells} filled cells. Blank cells never erase what's there. A measured flow outranks a typed-in AgSense number.</p>
        {pplan.items.some((i) => i.problems.length) && <div className="card" style={{ marginTop: 10 }}>
          {pplan.items.filter((i) => i.problems.length).slice(0, 25).map((i) => <div key={i.system} className="row"><span className="dot d-soon" /><span className="t"><b>{i.system}{i.existing ? '' : ' (new)'}</b><span>{i.problems.join('; ')}</span></span></div>)}
        </div>}
        <button className="cta" disabled={busy} onClick={() => run(async () => { const m = await applyPivotInfo(pplan, pfile!.name, me); setPplan(null); return m })}>Import {pplan.found} pivots</button>
      </>}

      <div className="sec">3. AgSense weekly export</div>
      <div className="card form">
        <div className="row"><label htmlFor="ag-from">Week from</label><input id="ag-from" type="date" value={agFrom} onChange={(e) => { setAgFrom(e.target.value); setAgPlan(null); setAgFile(null) }} /></div>
        <div className="row"><label htmlFor="ag-to">to</label><input id="ag-to" type="date" value={agTo} onChange={(e) => { setAgTo(e.target.value); setAgPlan(null); setAgFile(null) }} /></div>
        <div className="row"><label>Pivot Summary CSV<br /><span className="note" style={{ margin: 0 }}>Run the AgSense 365 Pivot Summary for that week and export it</span></label>
          <input key={agFrom + agTo} type="file" accept=".csv" onChange={async (e) => { const f = e.target.files?.[0] ?? null; setAgFile(f); setAgPlan(null); if (f) { try { setAgPlan(await planAgSense(await readTable(f), agFrom, agTo)) } catch (x: any) { setErr(x.message) } } }} /></div>
      </div>
      {agPlan && <>
        <Counts {...agPlan} />
        {agPlan.items.some((i) => i.problems.length) && <div className="card" style={{ marginTop: 10 }}>
          {agPlan.items.filter((i) => i.problems.length).map((i) => <div key={i.serial + i.alias} className="row"><span className="dot d-soon" /><span className="t"><b>{i.alias || i.serial}</b><span>{i.problems.join('; ')}</span></span></div>)}
        </div>}
        <p className="note">{agPlan.items.filter((i) => i.pivot && i.hours > 0 && !i.duplicate).length} pivots ran this week. Each becomes one entry with its hours, spread over the week in the water balance.</p>
        <button className="cta" disabled={busy} onClick={() => run(async () => { const m = await applyAgSense(agPlan, agFile!.name, me); setAgPlan(null); return m })}>Import AgSense week</button>
      </>}

      <div className="sec">4. Probe readings</div>
      <div className="card form">
        <div className="row"><label>Probe CSV<br /><span className="note" style={{ margin: 0 }}>date, field, and % full (or % used) from the check sites</span></label>
          <input type="file" accept=".csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) run(async () => importProbes(await readTable(f), f.name, me)) }} /></div>
      </div>

      <div className="sec">5. Weather</div>
      <div className="card form">
        <div className="row"><label>Weather CSV<br /><span className="note" style={{ margin: 0 }}>date, eto_in, and rain_in (add a pivot column for rain by pivot)</span></label>
          <input type="file" accept=".csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) run(async () => importWeather(await readTable(f), f.name, me, 'Imported: ' + f.name)) }} /></div>
      </div>

      <div className="sec">Try it</div>
      <div className="card">
        <button className="row" disabled={busy || state.fields.length > 0} onClick={() => run(async () => { await loadDemo(); return 'JA Minor 2026 demo loaded' })}>
          <span className="t"><b style={{ color: state.fields.length ? 'var(--fg3)' : 'var(--water)' }}>{busy ? 'Loading the demo…' : 'Load the JA Minor 2026 demo'}</b><span>{state.fields.length ? 'Only on an empty app' : '90 fields, 81 pivots, real 2026 soils, radar rain and ET, shown as of July 16'}</span></span>
        </button>
      </div>

      <div className="sec">Import history</div>
      {imports.length ? <div className="card">{imports.map((i) => <div key={i.id} className="row"><span className="t"><b>{i.kind}: {i.fileName}</b><span>{new Date(i.at).toLocaleString()} · {i.who} · {i.summary}</span></span></div>)}</div> : <p className="note">No imports yet.</p>}
    </div>
  )
}

export function Settings({ onMe, signOut, canAdmin }: { onMe: (name: string) => void; signOut: () => void; canAdmin: boolean }) {
  const { me, state, toast } = useNav()
  const hasPeople = useLiveQuery(() => db.people.count(), [], 0) > 0
  const [name, setName] = useState(me)
  const [asOf, setAsOf] = useState(state.asOf)
  const [sure, setSure] = useState(false)
  const waiting = useLiveQuery(() => db.entries.where('synced').equals(0).count(), [], 0)
  return (
    <div className="page">
      <h1 className="lt">Settings</h1>
      <div className="card form">
        {hasPeople ? <div className="row"><label>Signed in as</label><b>{me}</b></div>
          : <div className="row"><label htmlFor="me">Your name</label><input id="me" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { setSetting('me', name); onMe(name) }} placeholder="Shown on every entry" /></div>}
        <div className="row"><label>Water balance as of</label><input type="date" value={asOf} onChange={(e) => { setAsOf(e.target.value); setSetting('asOf', e.target.value || null) }} /></div>
      </div>
      <p className="note">Leave "as of" on today for the season. The demo sets it to July 16, 2026.</p>
      {hasPeople && <button className="cta sec2" onClick={signOut}>Switch person</button>}
      {canAdmin && <People />}
      <div className="sec">Saving</div>
      <div className="card kv">
        <span>On this phone, not sent</span><b>{waiting}</b>
        <span>Hosted database</span><b>{supabase ? 'Set up' : 'Not set up yet'}</b>
      </div>
      {supabase && <button className="cta sec2" onClick={async () => { const r = await pushEntries(); toast(r.error ?? `${r.sent} sent`) }}>Send now</button>}
      <p className="note">Until the farm's hosted database is set up, everything stays on this device. Don't clear browser data on a phone with unsent entries.</p>
      {canAdmin && <><div className="sec">Reset</div>
      <button className="cta off" onClick={() => (sure ? clearAll() : setSure(true))}>{sure ? 'Tap again to erase everything' : 'Erase this device'}</button>
      {sure && <p className="note warn">Entries not yet sent will be lost.</p>}</>}
    </div>
  )
}
