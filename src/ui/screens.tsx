import { useMemo, useState } from 'react'
import { db, uid } from '../db'
import { addDays } from '../model/waterBalance'
import { flow, hoursPerPass, inchesFrom, num } from '../domain/pivot'
import { centroid } from '../import/boundaries'
import { Chevron, FieldRow, PivotRow, Ring, fmtHours, fmtIn, fmtWhen, milesBetween, useGeo, useNav } from './common'

function Empty() {
  const { push } = useNav()
  return (
    <div className="card" style={{ padding: 16 }}>
      <b>No fields yet.</b>
      <p className="note" style={{ margin: '6px 0 0' }}>Import your fields and the pivot info sheet, or load the JA Minor 2026 demo to try it.</p>
      <button className="cta" onClick={() => push({ kind: 'import' })}>Import fields and pivots</button>
    </div>
  )
}

export function Today() {
  const { state, push } = useNav()
  const geo = useGeo()
  const running = state.pivots.filter((p) => p.running)
  const due = state.fields.filter((f) => f.advice.status === 'now' || f.advice.status === 'soon').sort((a, b) => b.advice.pctDry - a.advice.pctDry)
  const gaps = state.pivots.flatMap((p) => p.runs.filter((r) => r.issues.some((i) => !i.startsWith('No '))).map((r) => ({ p, r })))
  const near = useMemo(() => {
    if (!geo) return []
    return state.pivots.filter((p) => p.pivot.lat != null).map((p) => ({ p, mi: milesBetween(geo, { lat: p.pivot.lat!, lon: p.pivot.lon! }) })).sort((a, b) => a.mi - b.mi).slice(0, 6)
  }, [geo, state.pivots])
  const dateLabel = new Date(state.asOf + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <div className="page">
      <h1 className="lt">Today</h1>
      <p className="sub">{dateLabel}{state.asOf !== new Date().toISOString().slice(0, 10) ? ' (water balance as of this date)' : ''}</p>
      {!state.fields.length ? <Empty /> : <>
        <div className="tiles">
          <div className="tile"><b style={{ color: 'var(--water)' }}>{running.length}</b><span>Running</span></div>
          <div className="tile"><b style={{ color: 'var(--coral)' }}>{due.filter((d) => d.advice.status === 'now').length}</b><span>Water now</span></div>
          <div className="tile"><b style={{ color: 'var(--amber)' }}>{gaps.length}</b><span>Need a look</span></div>
        </div>
        {near.length > 0 && <>
          <div className="sec">Near me</div>
          <div className="card">{near.map(({ p, mi }) => <PivotRow key={p.pivot.id} p={p} sub={`${mi.toFixed(1)} mi · ${p.running ? `ON ${fmtHours((Date.now() - Date.parse(p.running.start!)) / 3600000)}` : p.fields.map((f) => f.name).join(', ')}`} />)}</div>
        </>}
        <div className="sec">Running now <small>{running.length} pivots</small></div>
        {running.length ? <div className="card">{running.map((p) => <PivotRow key={p.pivot.id} p={p} />)}</div> : <p className="note">Nothing logged as running.</p>}
        <div className="sec">Needs water <small>from the water balance</small></div>
        {due.length ? <div className="card">{due.slice(0, 12).map((v) => <FieldRow key={v.field.id} v={v} />)}</div> : <p className="note">No field is near its trigger.</p>}
        {gaps.length > 0 && <>
          <div className="sec">Need a look</div>
          <div className="card">{gaps.slice(0, 10).map(({ p, r }, i) => (
            <button key={i} className="row" onClick={() => push({ kind: 'pivot', id: p.pivot.id })}>
              <span className="dot d-soon" /><span className="t"><b>{p.pivot.name}</b><span>{r.issues.filter((x) => !x.startsWith('No ')).join('; ')}</span></span><Chevron />
            </button>))}
          </div>
        </>}
      </>}
    </div>
  )
}

export function Log() {
  const { state } = useNav()
  const [q, setQ] = useState('')
  const recent = [...state.entries].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, 40)
  const name = (id: string) => state.pivots.find((p) => p.pivot.id === id)?.pivot.name ?? '?'
  const list = state.pivots.filter((p) => !q || p.pivot.name.toLowerCase().includes(q.toLowerCase()) || p.fields.some((f) => f.name.toLowerCase().includes(q.toLowerCase())))
  return (
    <div className="page">
      <h1 className="lt">Log</h1>
      <p className="sub">Turn a pivot ON or OFF, or enter a run after the fact.</p>
      <input className="card" style={{ width: '100%', padding: '12px 14px', border: 0, fontSize: 16 }} placeholder="Search pivots or fields" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="sec">Pivots <small>{list.length}</small></div>
      {list.length ? <div className="card">{list.map((p) => <PivotRow key={p.pivot.id} p={p} />)}</div> : <p className="note">No pivots yet. Import fields first.</p>}
      <div className="sec">Recent entries</div>
      {recent.length ? <div className="card">{recent.map((e) => (
        <div key={e.id} className="row">
          <span className={`dot ${e.action === 'on' ? 'd-run' : e.action === 'off' ? 'd-none' : 'd-ok'}`} />
          <span className="t"><b>{name(e.pivotId)} {e.action === 'run' ? 'past run' : e.action.toUpperCase()}</b>
            <span>{e.action === 'run' ? `${fmtWhen(e.startAt!)} to ${fmtWhen(e.stopAt!)}` : fmtWhen(e.happenedAt)} · {e.who}{e.percentTimer ? ` · ${e.percentTimer}%` : ''}{e.synced ? '' : ' · on this phone'}</span></span>
          {e.action !== 'void' && <VoidButton id={e.id} pivotId={e.pivotId} />}
        </div>))}</div> : <p className="note">Nothing logged yet.</p>}
      <p className="note">Entries are never edited. "Undo" adds a correction that cancels the entry, and both stay in the records.</p>
    </div>
  )
}

function VoidButton({ id, pivotId }: { id: string; pivotId: string }) {
  const { state, me, toast } = useNav()
  if (state.entries.some((e) => e.action === 'void' && e.correctsId === id)) return <span className="pill p-none">Undone</span>
  return <button className="btn sm" onClick={async () => {
    if (!confirm('Cancel this entry? It stays in the records, marked as cancelled.')) return
    const now = new Date().toISOString()
    await db.entries.add({ id: uid(), pivotId, action: 'void', correctsId: id, happenedAt: now, recordedAt: now, who: me || 'Unknown', how: 'app', synced: 0 })
    toast('Entry cancelled')
  }}>Undo</button>
}

export function Fields() {
  const { state, push } = useNav()
  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 className="lt">Fields</h1>
        <button className="btn" onClick={() => push({ kind: 'import' })}>Import</button>
      </div>
      <p className="sub">{state.fields.length} fields on {state.pivots.length} pivots</p>
      {!state.fields.length ? <Empty /> : state.farms.map((farm) => {
        const fs = state.fields.filter((f) => f.field.farmId === farm.id)
        if (!fs.length) return null
        return <div key={farm.id}><div className="sec">{farm.name} <small>{fs.reduce((s, f) => s + (f.season?.acres ?? 0), 0).toFixed(0)} ac</small></div><div className="card">{fs.map((v) => <FieldRow key={v.field.id} v={v} />)}</div></div>
      })}
    </div>
  )
}

function SeasonChart({ days }: { days: { date: string; depletionApplied: number | null; depletionRainOnly: number; taw: number; trigger: number; rain: number; appliedGross: number }[] }) {
  if (days.length < 2) return null
  const W = 340, H = 140, n = days.length
  const maxT = Math.max(...days.map((d) => d.taw), 0.5)
  const x = (i: number) => (i / (n - 1)) * W
  const y = (v: number) => (v / maxT) * (H - 20) + 4 // depletion grows downward like a tank emptying
  const line = (k: (d: any) => number) => days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(k(d)).toFixed(1)}`).join('')
  const dep = (d: any) => d.depletionApplied ?? d.depletionRainOnly
  return (
    <div className="card chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Soil water this season">
        <path d={line((d) => d.trigger)} fill="none" stroke="var(--amber)" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d={line((d) => d.taw)} fill="none" stroke="var(--fg3)" strokeWidth="1" />
        {days.map((d, i) => d.rain >= 0.1 ? <rect key={'r' + i} x={x(i) - 1} y={4} width={2} height={Math.min(30, d.rain * 20)} fill="var(--rain)" /> : null)}
        {days.map((d, i) => d.appliedGross > 0.01 ? <rect key={'a' + i} x={x(i) - 1} y={4} width={2} height={Math.min(30, d.appliedGross * 20)} fill="var(--water)" opacity={0.6} /> : null)}
        <path d={line(dep)} fill="none" stroke="var(--leaf)" strokeWidth="2.2" />
        <text x="0" y={H - 2}>{days[0].date.slice(5)}</text><text x={W} y={H - 2} textAnchor="end">{days[n - 1].date.slice(5)}</text>
      </svg>
      <div className="leg"><span><i style={{ background: 'var(--leaf)' }} />Soil water (top = full)</span><span><i style={{ background: 'var(--amber)' }} />Water at this line</span><span><i style={{ background: 'var(--fg3)' }} />Empty</span><span><i style={{ background: 'var(--rain)' }} />Rain</span><span><i style={{ background: 'var(--water)' }} />Irrigation</span></div>
    </div>
  )
}

export function FieldDetail({ id }: { id: string }) {
  const { state, push, turn } = useNav()
  const v = state.fields.find((f) => f.field.id === id)
  if (!v) return <div className="page"><p className="note">Field not found.</p></div>
  const pv = v.pivot ? state.pivots.find((p) => p.pivot.id === v.pivot!.id) : null
  const last = v.days.at(-1)
  const a = v.advice
  const action = a.status === 'now' ? `Water now: put on about ${a.recommendGrossIn.toFixed(2)} in.` : a.status === 'soon' && a.daysToTrigger !== null ? `Water by ${new Date(addDays(state.asOf, a.daysToTrigger) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })}.` : a.line + '.'
  const pct = pv ? (() => {
    const f = flow(pv.pivot), h = num(pv.pivot, 'hoursPerRev100')
    if (!f || !h || !pv.acres || !a.recommendGrossIn) return null
    // timer that puts the recommended inches on in one pass
    const inchesAt100 = inchesFrom(f.gpm, h, pv.acres)
    return Math.min(100, Math.max(5, Math.round((100 * inchesAt100) / a.recommendGrossIn)))
  })() : null
  return (
    <div className="page">
      <div className="card hero">
        <Ring pct={a.pctDry} status={a.status} size={64} />
        <div><h2>{v.field.name}</h2><p className="act">{action}</p>
          <p>{[v.season?.crop, v.season ? `${v.season.acres} ac` : null, last ? `day ${last.dap} after planting` : null, v.farm?.name].filter(Boolean).join(' · ')}</p></div>
      </div>
      {pv && (pv.running
        ? <button className="cta off" onClick={() => turn(pv.pivot.id, 'off')}>Turn OFF {pv.pivot.name}</button>
        : <button className="cta" onClick={() => turn(pv.pivot.id, 'on')}>Turn ON {pv.pivot.name}{pct ? ` at ${pct}%` : ''}</button>)}
      <div className="sec">Season so far</div>
      <SeasonChart days={v.days} />
      <div className="card kv" style={{ marginTop: 10 }}>
        <span>Rain</span><b>{fmtIn(v.rainIn, 1)}</b>
        <span>Irrigation logged</span><b>{fmtIn(v.appliedIn, 1)}</b>
        <span>Model need so far</span><b>{fmtIn(v.needIn, 1)}</b>
        <span>Soil water used</span><b>{last ? `${((last.depletionApplied ?? last.depletionRainOnly)).toFixed(2)} of ${last.taw.toFixed(2)} in` : '–'}</b>
        <span>Planted</span><b>{v.season?.plantDate ?? '–'}</b>
        <span>Soil</span><b style={{ maxWidth: 220, whiteSpace: 'normal' }}>{v.pivot?.soil?.split(',')[0] ?? '–'}</b>
        <span>FSN</span><b>{v.field.fsn ?? '–'}</b>
      </div>
      {pv && <><div className="sec">Pivot</div><div className="card"><button className="row" onClick={() => push({ kind: 'pivot', id: pv.pivot.id })}><span className="t"><b>{pv.pivot.name}</b><span>{pv.running ? 'Running now' : pv.lastRun ? `Last off ${fmtWhen(pv.lastRun.stop!)}` : 'No runs logged'}</span></span><Chevron /></button></div></>}
      <p className="foot">Water balance as of {state.asOf}. Rain: NOAA radar by pivot. ET: {state.weatherSource || 'none loaded'}. "Irrigation logged" counts only runs in Pivot Log.</p>
    </div>
  )
}

const PROFILE_LABELS: [string, string][] = [
  ['irrigatedAcres', 'Irrigated acres'], ['flowGpm', 'Design flow (gpm)'], ['measuredGpm', 'Measured flow (gpm)'], ['agsenseGpm', 'AgSense gpm (typed in)'],
  ['hoursPerRev100', 'Hours per rev at 100%'], ['arcDeg', 'Circle (deg)'], ['endGun', 'End gun'], ['make', 'Make'], ['model', 'Model'], ['controlPanel', 'Control panel'],
  ['waterSource', 'Water source'], ['wellId', 'Well / intake ID'], ['epdPermit', 'GA EPD permit #'], ['stateMeterId', 'State meter ID'], ['dealer', 'Dealer'], ['knownProblems', 'Known problems'],
]

export function PivotDetail({ id }: { id: string }) {
  const { state, turn } = useNav()
  const pv = state.pivots.find((p) => p.pivot.id === id)
  if (!pv) return <div className="page"><p className="note">Pivot not found.</p></div>
  const f = flow(pv.pivot)
  const pass100 = hoursPerPass(pv.pivot, 100)
  return (
    <div className="page">
      <h1 className="lt">{pv.pivot.name}</h1>
      <p className="sub">{pv.farm?.name} · {pv.fields.map((x) => x.name).join(', ') || 'no fields'}{pv.pivot.agsenseName ? ' · on AgSense' : ''}</p>
      {pv.running ? <button className="cta off" onClick={() => turn(id, 'off')}>Turn OFF</button> : <button className="cta" onClick={() => turn(id, 'on')}>Turn ON</button>}
      <button className="cta sec2" onClick={() => turn(id, 'run')}>Log a past run</button>
      <div className="sec">Runs <small>{pv.runs.length}</small></div>
      {pv.runs.length ? <div className="card">{[...pv.runs].reverse().slice(0, 30).map((r, i) => (
        <div key={i} className="row">
          <span className={`dot ${!r.stop ? 'd-run' : r.issues.some((x) => !x.startsWith('No ')) ? 'd-soon' : 'd-ok'}`} />
          <span className="t"><b>{r.start ? fmtWhen(r.start) : 'Start unknown'} → {r.stop ? fmtWhen(r.stop) : 'running'}</b>
            <span>{[r.hours != null ? fmtHours(r.hours) : null, r.percentTimer ? `${r.percentTimer}%` : null, r.direction, r.madeItAround === true ? 'made it around' : r.madeItAround === false ? 'did not make it around' : null, ...r.issues].filter(Boolean).join(' · ')}</span></span>
          <span className="v">{r.inches != null ? fmtIn(r.inches) : ''}</span>
        </div>))}</div> : <p className="note">No runs logged yet.</p>}
      <div className="sec">Pivot profile</div>
      <div className="card kv">
        {PROFILE_LABELS.filter(([k]) => pv.pivot.profile[k]).flatMap(([k, l]) => [<span key={k + 'l'}>{l}</span>, <b key={k + 'v'}>{String(pv.pivot.profile[k].value)}<small>{pv.pivot.profile[k].source}</small></b>])}
        <span>Acres used for inches</span><b>{pv.acres ? pv.acres.toFixed(1) : '–'}</b>
        <span>Inches per pass at 100%</span><b>{f && pass100 && pv.acres ? inchesFrom(f.gpm, pass100, pv.acres).toFixed(2) : '–'}</b>
      </div>
      {!f && <p className="note warn">No flow rate yet. Fill "Design flow (gpm)" on the pivot info sheet and import it.</p>}
    </div>
  )
}

export function MapView() {
  const { state, push } = useNav()
  const shapes = state.fields.filter((f) => f.field.boundary)
  const box = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    const walk = (c: any) => { if (typeof c[0] === 'number') { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]) } else c.forEach(walk) }
    shapes.forEach((s) => walk(s.field.boundary!.coordinates))
    return { x0, x1, y0, y1 }
  }, [shapes])
  if (!shapes.length) return <div className="page"><h1 className="lt">Map</h1><Empty /></div>
  const k = Math.cos(((box.y0 + box.y1) / 2) * Math.PI / 180)
  const W = 1000, s = W / ((box.x1 - box.x0) * k), H = (box.y1 - box.y0) * s
  const pt = (c: number[]) => `${((c[0] - box.x0) * k * s).toFixed(1)},${((box.y1 - c[1]) * s).toFixed(1)}`
  const d = (g: any) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p: number[][][]) => p.map((r) => 'M' + r.map(pt).join('L') + 'Z').join('')).join('')
  const color: Record<string, string> = { now: 'var(--coral)', soon: 'var(--amber)', ok: 'var(--leaf)', none: 'var(--fg3)', off: 'var(--fg3)' }
  return (
    <div className="page wide">
      <h1 className="lt">Map</h1>
      <p className="sub">Tap a field. Blue outline = pivot running.</p>
      <div className="map">
        <svg viewBox={`-10 -10 ${W + 20} ${H + 20}`}>
          {shapes.map((v) => {
            const run = v.pivot && state.pivots.find((p) => p.pivot.id === v.pivot!.id)?.running
            const [cx, cy] = centroid(v.field.boundary!)
            return <g key={v.field.id} onClick={() => push({ kind: 'field', id: v.field.id })}>
              <path d={d(v.field.boundary)} fill={color[v.advice.status]} fillOpacity={0.75} style={run ? { stroke: 'var(--water)', strokeWidth: 3 } : undefined}><title>{v.field.name}: {v.advice.line}</title></path>
              <text x={pt([cx, cy]).split(',')[0]} y={pt([cx, cy]).split(',')[1]} textAnchor="middle" style={{ font: '600 9px var(--text)', fill: 'var(--fg)', pointerEvents: 'none' }}>{v.field.name.replace(/ Farm$/, '')}</text>
            </g>
          })}
        </svg>
      </div>
      <div className="leg" style={{ margin: '10px 4px' }}><span><i style={{ background: 'var(--coral)' }} />Water now</span><span><i style={{ background: 'var(--amber)' }} />Water soon</span><span><i style={{ background: 'var(--leaf)' }} />OK</span><span><i style={{ background: 'var(--fg3)' }} />Not modeled</span></div>
      <p className="note">Satellite imagery and zoom come with the map library in the next step.</p>
    </div>
  )
}

