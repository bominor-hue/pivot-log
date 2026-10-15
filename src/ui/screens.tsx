import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid } from '../db'
import { growthStage, isCrop, type BalanceDay } from '../model/waterBalance'
import type { FieldView } from '../domain/farm'
import type { Run } from '../domain/runs'
import { flow, hoursPerPass, inchesFrom, num } from '../domain/pivot'
import { ChartRead } from './ChartRead'
import { Chevron, CropBar, FieldRow, Head, PivotRow, Ring, Seg, describeEntry, fmtHours, fmtIn, fmtWhen, milesBetween, runningLine, useGeo, useNav } from './common'
import { Count, CropTile, DropIcon, Drops, Gauge, LapRing, MiniPivot, RunIcon, Sprinkler, Sprout, Sun, Tank } from './brand'
import { STATUS_ORDER, cropUseToday, lastNightRain, pivotStatus, soilFull } from '../domain/crop'

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

const CROP_WORD: Record<string, string> = { Cotton: 'cotton', Peanuts: 'peanut', Corn: 'corn' }

export function Today() {
  const { state, push, turn, crop = 'All' } = useNav()
  const geo = useGeo()
  const rows = state.pivots.map((p) => ({ p, ...pivotStatus(p, state.fields) }))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (b.field?.advice.pctDry ?? 0) - (a.field?.advice.pctDry ?? 0) || a.p.pivot.name.localeCompare(b.p.pivot.name, undefined, { numeric: true }))
  const running = rows.filter((r) => r.status === 'run')
  const now = rows.filter((r) => r.status === 'now').length
  const soon = rows.filter((r) => r.status === 'soon').length
  const acres = rows.reduce((s, r) => s + (r.p.acres ?? 0), 0)
  const soil = soilFull(state.fields)
  const rain = lastNightRain(state.fields)
  const use = cropUseToday(state.fields)
  const gaps = state.pivots.flatMap((p) => p.runs.filter((r) => r.issues.some((i) => !i.startsWith('No '))).map((r) => ({ p, r })))
  const probeGaps = state.fields.filter((f) => f.probeGap)
  const near = useMemo(() => {
    if (!geo) return []
    return state.pivots.filter((p) => p.pivot.lat != null).map((p) => ({ p, mi: milesBetween(geo, { lat: p.pivot.lat!, lon: p.pivot.lon! }) })).sort((a, b) => a.mi - b.mi).slice(0, 4)
  }, [geo, state.pivots])
  const dateLabel = new Date(state.asOf + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const label = crop === 'All' ? 'pivots' : `${CROP_WORD[crop]} pivots`
  const modeled = soil !== null
  return (
    <div className="page">
      <Head title="Today" sub={<>{dateLabel}{state.asOf !== new Date().toISOString().slice(0, 10) ? ' (as of)' : ''} · {rows.length} {label} · {Math.round(acres).toLocaleString()} ac</>} />
      {!state.fields.length && crop === 'All' ? <Empty /> : <>
        <CropBar />
        <div className="card hero">
          <div className="mini">{running.length ? <Sprinkler /> : modeled && now === 0 ? <Sprout /> : <DropIcon />}</div>
          <div>
            <h2>{!modeled ? 'No water balance yet' : now === 0 ? 'Nothing needs water today' : `Water ${now} ${now === 1 ? 'pivot' : 'pivots'} today`}</h2>
            <p>{running.length} running now{running.length ? `: ${running.slice(0, 4).map((r) => r.p.pivot.name).join(', ')}${running.length > 4 ? ` and ${running.length - 4} more` : ''}` : ''}.{soon ? ` ${soon} more soon.` : ''}{!modeled ? ' Load weather and crop dates to see what needs water.' : ''}</p>
          </div>
        </div>
        {modeled && <div className="card soil">
          <Tank level={soil!} />
          <div><b><Count to={soil!} />% full</b><span>Average soil water on the {label} shown, by acres. The dashed line is about where they need water.</span></div>
        </div>}
        {modeled && <div className="pair">
          <div className="card wx">{rain.inches >= 0.1 && <Drops />}
            <div className="top"><Gauge inches={rain.inches} /><div><b><Count to={rain.inches} dec={2} /></b><small> in</small></div></div>
            <span>{rain.inches >= 0.1 ? `Most any pivot got last night; rain on ${rain.farms.length > 2 ? `${rain.farms.length} farms` : rain.farms.join(' and ')}` : 'No rain to speak of last night'}</span>
          </div>
          <div className="card wx">
            <div className="top"><Sun /><div><b><Count to={use ?? 0} dec={2} /></b><small> in</small></div></div>
            <span>Crop water use today, average of the fields shown</span>
          </div>
        </div>}
        {gaps.length + probeGaps.length > 0 && <>
          <div className="sec">Need a look <small>{gaps.length + probeGaps.length}</small></div>
          <div className="card">{gaps.slice(0, 10).map(({ p, r }, i) => (
            <button key={i} className="row" onClick={() => push({ kind: 'pivot', id: p.pivot.id })}>
              <span className="dot d-soon" /><span className="t"><b>{p.pivot.name}</b><span>{r.issues.filter((x) => !x.startsWith('No ')).join('; ')}</span></span><Chevron />
            </button>))}
            {probeGaps.map((f) => (
              <button key={f.field.id} className="row" onClick={() => push({ kind: 'field', id: f.field.id })}>
                <span className="dot d-soon" /><span className="t"><b>{f.field.name}</b><span>Probe {f.probeGap!.probe.toFixed(0)}% used vs model {f.probeGap!.model.toFixed(0)}%</span></span><Chevron />
              </button>))}
          </div>
        </>}
        {near.length > 0 && <>
          <div className="sec">Near me</div>
          <div className="card">{near.map(({ p, mi }) => <PivotRow key={p.pivot.id} p={p} sub={`${mi.toFixed(1)} mi · ${p.running ? `ON ${fmtHours((Date.now() - Date.parse(p.running.start!)) / 3600000)}` : p.fields.map((f) => f.name).join(', ')}`} />)}</div>
        </>}
        <div className="sec">Pivots <small>Most urgent first</small></div>
        {rows.length ? <div className="card">{rows.map(({ p, status, field, crop: c }, i) => {
          const full = field && field.advice.status !== 'none' && field.advice.status !== 'off' ? Math.round(100 - field.advice.pctDry) : null
          const wet = field?.days.at(-1)?.rain ?? 0
          const sub = status === 'run' ? runningLine(p.running!)
            : full === null ? field?.advice.line ?? 'No field this year'
            : [`Soil ${full}% full`, status === 'soon' ? field!.advice.line : null, wet >= 0.1 ? `rain ${wet.toFixed(2)} in last night` : null].filter(Boolean).join(' · ')
          return (
            <div key={p.pivot.id} className="row stag" style={{ '--i': Math.min(i, 14) } as any}>
              <button className="rowmain" onClick={() => push({ kind: 'pivot', id: p.pivot.id })}>
                <span className="ic"><CropTile crop={c} /></span>
                <span className="t"><b>{p.pivot.name}</b><span>{sub}{p.acres ? ` · ${Math.round(p.acres)} ac` : ''}</span></span>
              </button>
              {status === 'run' ? <button className="pill p-run" onClick={() => turn(p.pivot.id, 'off')} aria-label={`Turn off ${p.pivot.name}`}><MiniPivot />Running</button>
                : status === 'now' ? <button className="pill p-now" onClick={() => turn(p.pivot.id, 'on')} aria-label={`Turn on ${p.pivot.name}`}>Water today</button>
                : status === 'soon' ? <button className="pill p-soon" onClick={() => turn(p.pivot.id, 'on')} aria-label={`Turn on ${p.pivot.name}`}>Soon</button>
                : status === 'ok' ? <span className="pill p-ok">OK</span>
                : field?.advice.status === 'off' ? <span className="pill p-off">Done</span> : null}
            </div>)
        })}</div> : <p className="note">No pivots water {crop === 'All' ? 'a crop' : CROP_WORD[crop]} this year.</p>}
        <p className="note">Tap "Water today" or "Soon" to turn a pivot on, "Running" to turn it off, or the name to open it. The crop filter stays set on every tab.</p>
      </>}
    </div>
  )
}

const HOW: Record<string, string> = { app: 'Pivot Log app', office: 'Office', agsense: 'AgSense', import: 'Import' }
const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date(), y = new Date(Date.now() - 86400000)
  const base = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return d.toDateString() === t.toDateString() ? `Today, ${base}` : d.toDateString() === y.toDateString() ? `Yesterday, ${base}` : base
}
const OFF_ICON = <svg viewBox="0 0 30 30" width="30" height="30" aria-label="Stopped"><circle cx="15" cy="15" r="11" fill="none" stroke="var(--fg3)" strokeWidth="3.4" /><rect x="11.5" y="11.5" width="7" height="7" rx="1.5" fill="var(--fg3)" /></svg>
const FILE_ICON = <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--fg2)" strokeWidth="1.8" strokeLinejoin="round" aria-label="Imported"><path d="M6 3.5h8l4 4v13H6z" /><path d="M14 3.5v4h4M9 13h6M9 16.5h6" /></svg>
const UNDO_ICON = <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--fg3)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label="Correction"><path d="M9 7 5 11l4 4" /><path d="M5 11h9a5 5 0 0 1 0 10h-2" /></svg>
const NOTE_ICON = <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--fg2)" strokeWidth="1.8" strokeLinecap="round" aria-label="Note"><path d="M5 5h14v10l-4 4H5z" /><path d="M8.5 9.5h7M8.5 13h4" /></svg>

/** History only: what was done, by whom, from which source. Starting and stopping pivots is on Today and Map. */
export function Log() {
  const { state } = useNav()
  const name = (id: string) => state.pivots.find((p) => p.pivot.id === id)?.pivot.name ?? '?'
  const runOf = new Map<string, Run>()
  for (const p of state.pivots) for (const r of p.runs) for (const id of r.entryIds) runOf.set(id, r)
  const voided = new Set(state.entries.filter((e) => e.action === 'void').map((e) => e.correctsId))
  const list = [...state.entries].sort((a, b) => b.happenedAt.localeCompare(a.happenedAt) || b.recordedAt.localeCompare(a.recordedAt)).slice(0, 150)
  const days: [string, typeof list][] = []
  for (const e of list) {
    const k = new Date(e.happenedAt).toDateString()
    if (days.at(-1)?.[0] !== k) days.push([k, []])
    days.at(-1)![1].push(e)
  }
  const counted = new Set<Run>()
  for (const e of list) { const r = runOf.get(e.id); if (r?.stop && r.inches != null && !voided.has(e.id) && (e.action === 'off' || e.action === 'run')) counted.add(r) }
  const inches = [...counted].reduce((s, r) => s + (r.inches ?? 0), 0)
  return (
    <div className="page">
      <Head title="Log" sub="What's been done, newest first" />
      {state.fields.length > 0 && <CropBar />}
      {list.length > 0 && <div className="card sumrow">
        <div><b><Count to={list.length} /></b><span>entries</span></div>
        <div><b><Count to={inches} dec={2} /></b><span>in applied</span></div>
        <div><b><Count to={days.length} /></b><span>days</span></div>
      </div>}
      {days.map(([k, es]) => <div key={k}>
        <div className="day">{dayLabel(es[0].happenedAt)}</div>
        <div className="card">{es.map((e, i) => {
          const r = runOf.get(e.id), n = name(e.pivotId), gone = voided.has(e.id)
          const title = e.action === 'on' ? `${n} started`
            : e.action === 'off' ? (e.madeItAround === true ? `${n} stopped, made it around` : e.madeItAround === false ? `${n} stopped short${e.stopDeg != null ? ` at ${e.stopDeg}°` : ''}` : `${n} stopped`)
            : e.action === 'run' ? (e.how === 'agsense' ? `${n} on AgSense${e.hours != null ? `: ${e.hours} h` : ''}` : `${n} past run`)
            : e.action === 'void' ? `Correction on ${n}` : `${n} note`
          const sub = (e.action === 'off' || e.action === 'run') && r?.stop && r.hours != null
            ? [fmtHours(r.hours), r.inches != null ? `${r.inches.toFixed(2)} in applied` : null].filter(Boolean).join(' · ') : describeEntry(e)
          const icon = e.action === 'on' ? <RunIcon live={!!r && !r.stop} />
            : e.action === 'off' ? (e.madeItAround === true ? <LapRing frac={1} ok /> : e.madeItAround === false ? <LapRing frac={e.stopDeg != null ? e.stopDeg / 360 : 0.6} ok={false} /> : OFF_ICON)
            : e.action === 'run' ? (e.how === 'agsense' ? FILE_ICON : r?.madeItAround ? <LapRing frac={1} ok /> : FILE_ICON)
            : e.action === 'void' ? UNDO_ICON : NOTE_ICON
          return (
            <div key={e.id} className={'ent stag' + (gone ? ' gone' : '')} style={{ '--i': Math.min(i, 10) } as any}>
              <span className="ic">{icon}</span>
              <div style={{ minWidth: 0 }}><b>{title}</b><span>{sub}</span><em>{e.who} · {HOW[e.how] ?? e.how}{e.synced ? '' : ' · on this phone, not sent yet'}{gone ? ' · cancelled' : ''}</em></div>
              <div className="ent-r"><time>{new Date(e.happenedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</time>{e.action !== 'void' && !gone && <VoidButton id={e.id} pivotId={e.pivotId} />}</div>
            </div>)
        })}</div>
      </div>)}
      {!list.length && <p className="note">Nothing logged yet. Turn pivots on and off from Today or Map.</p>}
      <p className="note">History only. To start or stop a pivot, use Today or Map. A correction adds a new entry; nothing is erased, so the records hold up for NRCS and EQIP.</p>
    </div>
  )
}

function VoidButton({ id, pivotId }: { id: string; pivotId: string }) {
  const { state, me, toast } = useNav()
  const [sure, setSure] = useState(false)
  // Two taps instead of a confirm() dialog, which some browsers and embedded views block.
  return <button className={`undo ${sure ? 'sure' : ''}`} onBlur={() => setSure(false)} onClick={async () => {
    if (!sure) { setSure(true); return }
    const now = new Date().toISOString()
    await db.entries.add({ id: uid(), pivotId, action: 'void', correctsId: id, happenedAt: now, recordedAt: now, who: me || 'Unknown', how: 'app', synced: 0 })
    toast('Entry cancelled; it stays in the records')
  }}>{sure ? 'Tap to confirm' : 'Undo'}</button>
}

export function Fields() {
  const { state, push } = useNav()
  return (
    <div className="page">
      <Head title="Fields" sub={<>{state.fields.length} fields on {state.pivots.length} pivots · <button className="link" onClick={() => push({ kind: 'import' })}>Import</button></>} />
      <CropBar />
      {!state.fields.length ? <Empty /> : state.farms.map((farm) => {
        const fs = state.fields.filter((f) => f.field.farmId === farm.id)
        if (!fs.length) return null
        return <div key={farm.id}><div className="sec">{farm.name} <small>{fs.reduce((s, f) => s + (f.season?.acres ?? 0), 0).toFixed(0)} ac</small></div><div className="card">{fs.map((v) => <FieldRow key={v.field.id} v={v} />)}</div></div>
      })}
    </div>
  )
}

function SoilChart({ v }: { v: FieldView }) {
  const days = v.days
  if (days.length < 2) return null
  const W = 340, H = 150, L = 34, B = 16, n = days.length
  const x = (i: number) => L + (i / (n - 1)) * (W - L - 4)
  const y = (pct: number) => 6 + (Math.min(100, Math.max(0, pct)) / 100) * (H - B - 6) // 0% used (full) at top
  const pctOf = (d: BalanceDay) => (d.taw > 0 ? (100 * (d.depletionApplied ?? d.depletionRainOnly)) / d.taw : 0)
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pctOf(d)).toFixed(1)}`).join('')
  const trig = days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.taw > 0 ? (100 * d.trigger) / d.taw : 50).toFixed(1)}`).join('')
  const idx = new Map(days.map((d, i) => [d.date, i]))
  return (
    <div className="card chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Soil water used this season, percent">
        {[0, 50, 100].map((p) => <g key={p}><line x1={L} x2={W - 4} y1={y(p)} y2={y(p)} stroke="var(--sep)" /><text x={L - 4} y={y(p) + 3} textAnchor="end">{p}%</text></g>)}
        <path d={trig} fill="none" stroke="var(--amber)" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d={line} fill="none" stroke="var(--leaf)" strokeWidth="2.2" />
        {v.probes.filter((p) => idx.has(p.date)).map((p) => <circle key={p.id} cx={x(idx.get(p.date)!)} cy={y(p.pctUsed)} r="3.2" fill="var(--card)" stroke="var(--fg)" strokeWidth="1.5" />)}
        <text x={L} y={H - 2}>{days[0].date.slice(5)}</text><text x={W - 4} y={H - 2} textAnchor="end">{days[n - 1].date.slice(5)}</text>
      </svg>
      <div className="leg"><span><i style={{ background: 'var(--leaf)' }} />Soil water used (model)</span><span><i style={{ background: 'var(--amber)' }} />Water at</span>{v.probes.length > 0 && <span><i style={{ background: 'var(--fg)', height: 6, width: 6, borderRadius: 3 }} />Probe</span>}</div>
    </div>
  )
}

function SeasonChart({ days }: { days: BalanceDay[] }) {
  if (days.length < 2) return null
  const W = 340, H = 140, L = 34, B = 16, n = days.length
  let r = 0, nd = 0, a = 0
  const cum = days.map((d) => ({ r: (r += d.rain >= 0.1 ? d.rain : 0), n: (nd += d.irrRecGross), a: (a += d.appliedGross) }))
  const max = Math.max(1, ...cum.map((c) => Math.max(c.r, c.n, c.a)))
  const top = Math.ceil(max / 5) * 5
  const x = (i: number) => L + (i / (n - 1)) * (W - L - 4)
  const y = (v: number) => H - B - (v / top) * (H - B - 6)
  const path = (k: 'r' | 'n' | 'a') => cum.map((c, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(c[k]).toFixed(1)}`).join('')
  return (
    <div className="card chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Rain, model need and applied water, season to date">
        {[0, top / 2, top].map((v) => <g key={v}><line x1={L} x2={W - 4} y1={y(v)} y2={y(v)} stroke="var(--sep)" /><text x={L - 4} y={y(v) + 3} textAnchor="end">{v}</text></g>)}
        <path d={path('r')} fill="none" stroke="var(--rain)" strokeWidth="2" />
        <path d={path('n')} fill="none" stroke="var(--amber)" strokeWidth="2" strokeDasharray="4 3" />
        <path d={path('a')} fill="none" stroke="var(--water)" strokeWidth="2.4" />
        <text x={L} y={H - 2}>{days[0].date.slice(5)}</text><text x={W - 4} y={H - 2} textAnchor="end">{days[n - 1].date.slice(5)}</text>
      </svg>
      <div className="leg"><span><i style={{ background: 'var(--rain)' }} />Rain</span><span><i style={{ background: 'var(--amber)' }} />Model need</span><span><i style={{ background: 'var(--water)' }} />Applied</span><span>inches, season to date</span></div>
    </div>
  )
}

/** A label and number that opens to show where the number came from ("show me why"). */
function Why({ label, value, why }: { label: string; value: string; why: string }) {
  const [open, setOpen] = useState(false)
  return (
    <button className="why" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="wl">{label}</span><b>{value}</b>
      {open && <span className="wy">{why}</span>}
    </button>
  )
}

export function FieldDetail({ id }: { id: string }) {
  const { state, push, turn } = useNav()
  const v = state.fields.find((f) => f.field.id === id)
  if (!v) return <div className="page"><p className="note">Field not found.</p></div>
  const pv = v.pivot ? state.pivots.find((p) => p.pivot.id === v.pivot!.id) : null
  const last = v.days.at(-1)
  const a = v.advice
  const crop = v.season && isCrop(v.season.crop) ? v.season.crop : null
  const stage = crop && last ? growthStage(crop, last.dap) : null
  const dep = last ? last.depletionApplied ?? last.depletionRainOnly : 0
  const f = pv ? flow(pv.pivot) : null
  const timer = pv && f && pv.lapHours100 && pv.acres && a.recommendGrossIn
    ? Math.min(100, Math.max(5, Math.round((100 * inchesFrom(f.gpm, pv.lapHours100.hours * ((num(pv.pivot, 'arcDeg') ?? 360) / 360), pv.acres)) / a.recommendGrossIn))) : null
  const runs = pv ? [...pv.runs].reverse().slice(0, 3) : []
  return (
    <div className="page">
      <div className="card hero">
        <Ring pct={a.pctDry} status={a.status} size={64} />
        <div><h2>{v.field.name}</h2><p className="act">{a.line}{a.status === 'now' || a.status === 'soon' ? `, about ${a.recommendGrossIn.toFixed(2)} in` : ''}</p>
          <p>{[v.season?.crop, v.season ? `${v.season.acres} ac` : null, v.farm?.name].filter(Boolean).join(' · ')}</p></div>
      </div>
      {pv && (pv.running
        ? <button className="cta off" onClick={() => turn(pv.pivot.id, 'off')}>Turn off {pv.pivot.name}</button>
        : <button className="cta" onClick={() => turn(pv.pivot.id, 'on')}>Turn on {pv.pivot.name}{timer ? ` at ${timer}%` : ''}</button>)}
      {v.probeGap && <p className="calc warn">Probe reads {v.probeGap.probe.toFixed(0)}% used on {v.probeGap.date}; the model says {v.probeGap.model.toFixed(0)}%. Check the probe and the field.</p>}
      {stage && last && <div className="card stg" style={{ marginTop: 10 }}>
        <span className="chip">{last.dap}</span>
        <div><b>{stage.name}</b><span>{stage.tip} Day {last.dap} after planting; stage is approximate.</span></div>
      </div>}
      {last && <>
        <div className="sec">Show me why <small>tap a number</small></div>
        <div className="card">
          <Why label="Soil water used" value={`${a.pctDry.toFixed(0)}%`} why={`${dep.toFixed(2)} in used of the ${last.taw.toFixed(2)} in this soil holds in today's root zone (SSURGO, ${v.pivot?.soil?.split(',')[0] ?? 'soil'}). Each day: yesterday + crop use − rain − irrigation.`} />
          <Why label="Water at" value={`${((100 * last.trigger) / last.taw).toFixed(0)}% used`} why={crop === 'Corn' && last.dap >= 50 && last.dap <= 95 ? 'Corn at peak (50 to 95 days) is watered at 45% used; the rest of the season at 50%.' : 'Fields are watered when half the soil water is used (UGA and FAO-56 practice).'} />
          <Why label="Crop use" value={`${a.cropUsePerDay.toFixed(2)} in/day`} why={`Average of the last 7 days: reference ET (${state.weatherSource || 'weather'}) × crop coefficient ${last.kc.toFixed(2)} for day ${last.dap}.`} />
          <Why label="Days until water is needed" value={a.daysToTrigger === null ? '–' : `${a.daysToTrigger}`} why={`${Math.max(0, last.trigger - dep).toFixed(2)} in of room before the water-at line ÷ ${a.cropUsePerDay.toFixed(2)} in/day. A lap takes about ${a.lapDays.toFixed(1)} days${pv?.lapHours100 ? ` (${pv.lapHours100.source})` : ' (no lap time yet; 1 day assumed)'}, so ${a.startInDays === 0 ? 'start today' : a.startInDays === null ? 'no start date yet' : `start in ${a.startInDays} day${a.startInDays > 1 ? 's' : ''}`}.`} />
          <Why label="This week" value={a.weekGrossIn > 0.05 ? `about ${a.weekGrossIn.toFixed(2)} in` : 'none needed'} why={`Soil water used now (${dep.toFixed(2)} in) + 7 days of crop use (${(7 * a.cropUsePerDay).toFixed(2)} in) − the water-at line (${last.trigger.toFixed(2)} in), ÷ 85% efficiency. Forecast rain isn't counted yet.`} />
          <Why label="Rain this season" value={fmtIn(v.rainIn, 1)} why="NOAA MRMS radar and gauge rain, averaged over the 3 by 3 km around the pivot center. Days under 0.10 in don't count." />
          <Why label="Applied this season" value={fmtIn(v.appliedIn, 1)} why={`Logged runs on ${v.pivot?.name ?? 'the pivot'}: gpm × hours ÷ (452.6 × acres)${f ? `, using ${f.gpm} gpm (${f.source})` : ''}. AgSense weekly totals are spread over their week.`} />
          <Why label="Model need this season" value={fmtIn(v.needIn, 1)} why="What the model would have put on: refill when the field reaches the water-at line, up to 1 in (0.75 in peanuts) at a time, ÷ 85% efficiency." />
        </div>
      </>}
      <div className="sec">Soil water</div>
      <SoilChart v={v} />
      <div className="sec">Season so far</div>
      <SeasonChart days={v.days} />
      {pv && <>
        <div className="sec">Last runs</div>
        <div className="card">
          {runs.length ? runs.map((r, i) => <RunRow key={i} r={r} />) : <div className="row"><span className="t"><span>No runs logged yet.</span></span></div>}
          <button className="row" onClick={() => push({ kind: 'pivot', id: pv.pivot.id })}><span className="t"><b style={{ color: 'var(--water)' }}>{pv.pivot.name}: all runs and pivot profile</b></span><Chevron /></button>
        </div>
      </>}
      <p className="foot">Water balance as of {state.asOf}. Planted {v.season?.plantDate ?? '–'}. FSN {v.field.fsn ?? '–'}. Rain: NOAA MRMS. ET: {state.weatherSource || 'none loaded'}.</p>
    </div>
  )
}

export function RunRow({ r }: { r: Run }) {
  return (
    <div className="row">
      <span className={`dot ${!r.stop ? 'd-run' : r.issues.some((x) => !x.startsWith('No ')) ? 'd-soon' : 'd-ok'}`} />
      <span className="t"><b>{r.periodHours != null ? `AgSense week to ${fmtWhen(r.stop!)}` : `${r.start ? fmtWhen(r.start) : 'Start unknown'} → ${r.stop ? fmtWhen(r.stop) : 'running'}`}</b>
        <span>{[r.hours != null ? fmtHours(r.hours) : null, r.direction ? cap(r.direction) : null, r.percentTimer ? `${r.percentTimer}%` : null,
          r.madeItAround === true ? 'made it around' : r.madeItAround === false ? 'stopped part way' : null, ...r.issues].filter(Boolean).join(' · ')}</span></span>
      <span className="v">{r.inches != null ? fmtIn(r.inches) : ''}</span>
    </div>
  )
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

const PROFILE_LABELS: [string, string][] = [
  ['irrigatedAcres', 'Irrigated acres'], ['flowGpm', 'Design flow (gpm)'], ['measuredGpm', 'Measured flow (gpm)'], ['agsenseGpm', 'AgSense gpm (typed in)'],
  ['hoursPerRev100', 'Hours per rev at 100%'], ['arcDeg', 'Circle (deg)'], ['designPsi', 'Design pressure (psi)'], ['lengthFt', 'Length (ft)'], ['wettedRadiusFt', 'Wetted radius (ft)'], ['towers', 'Towers'],
  ['endGun', 'End gun'], ['sprinklerPackage', 'Sprinkler package'], ['make', 'Make'], ['model', 'Model'], ['serial', 'Serial / order #'], ['controlPanel', 'Control panel'],
  ['waterSource', 'Water source'], ['wellId', 'Well / intake ID'], ['epdPermit', 'GA EPD permit #'], ['stateMeterId', 'State meter ID'], ['dealer', 'Dealer'], ['knownProblems', 'Known problems'],
]

export function PivotDetail({ id }: { id: string }) {
  const { state, turn } = useNav()
  const pv = state.pivots.find((p) => p.pivot.id === id)
  if (!pv) return <div className="page"><p className="note">Pivot not found.</p></div>
  const f = flow(pv.pivot)
  const pass100 = hoursPerPass(pv.pivot, 100, pv.lapHours100?.hours ?? null)
  return (
    <div className="page">
      <h1 className="lt">{pv.pivot.name}</h1>
      <p className="sub">{pv.farm?.name} · {pv.fields.map((x) => x.name).join(', ') || 'no fields'}{pv.pivot.agsenseName ? ' · on AgSense' : ''}</p>
      {pv.running ? <button className="cta off" onClick={() => turn(id, 'off')}>Turn OFF</button> : <button className="cta" onClick={() => turn(id, 'on')}>Turn ON</button>}
      <button className="cta sec2" onClick={() => turn(id, 'run')}>Log a past run</button>
      <div className="sec">Runs <small>{pv.runs.length}</small></div>
      {pv.runs.length ? <div className="card">{[...pv.runs].reverse().slice(0, 30).map((r, i) => <RunRow key={i} r={r} />)}</div> : <p className="note">No runs logged yet.</p>}
      <div className="sec">Pivot profile</div>
      <div className="card kv">
        {PROFILE_LABELS.filter(([k]) => pv.pivot.profile[k]).flatMap(([k, l]) => [<span key={k + 'l'}>{l}</span>, <b key={k + 'v'}>{String(pv.pivot.profile[k].value)}<small>{pv.pivot.profile[k].source}</small></b>])}
        <span>Hours per lap at 100%</span><b>{pv.lapHours100 ? pv.lapHours100.hours.toFixed(1) : '–'}<small>{pv.lapHours100?.source ?? 'learned once a lap is marked "made it around"'}</small></b>
        <span>Acres used for inches</span><b>{pv.acres ? pv.acres.toFixed(1) : '–'}</b>
        <span>Inches per pass at 100%</span><b>{f && pass100 && pv.acres ? inchesFrom(f.gpm, pass100, pv.acres).toFixed(2) : '–'}</b>
      </div>
      {!f && <p className="note warn">No flow rate yet. Fill "Design flow (gpm)" on the pivot info sheet and import it, or read it from the sprinkler chart.</p>}
      <ChartRead pivot={pv.pivot} />
    </div>
  )
}

type Layer = 'water' | 'rain' | 'crop'
const STATUS_COLOR: Record<string, string> = { now: 'var(--coral)', soon: 'var(--amber)', ok: 'var(--leaf)', none: 'var(--fg3)', off: 'var(--fg3)' }
const CROP_COLOR: Record<string, string> = { Corn: 'var(--corn)', Cotton: 'var(--cotton)', Peanuts: 'var(--peanut)' }

export function MapView() {
  const { state, push } = useNav()
  const [layer, setLayer] = useState<Layer>('water')
  const [farm, setFarm] = useState('')
  const [view, setView] = useState<{ x: number; y: number; k: number }>({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const imagery = useLiveQuery(() => db.settings.get('imagery'), [])?.value as { url: string; bounds: [number, number, number, number]; label: string } | undefined
  const shapes = state.fields.filter((f) => f.field.boundary && (!farm || f.farm?.id === farm))
  const box = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    const walk = (c: any) => { if (typeof c[0] === 'number') { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]) } else c.forEach(walk) }
    shapes.forEach((s) => walk(s.field.boundary!.coordinates))
    const px = (x1 - x0) * 0.04, py = (y1 - y0) * 0.04
    return { x0: x0 - px, x1: x1 + px, y0: y0 - py, y1: y1 + py }
  }, [shapes])
  if (!state.fields.some((f) => f.field.boundary)) return <div className="page"><Head title="Map" /><CropBar /><Empty /></div>
  const k = Math.cos(((box.y0 + box.y1) / 2) * Math.PI / 180)
  const W = 1000, s = W / ((box.x1 - box.x0) * k), H = (box.y1 - box.y0) * s
  const X = (lon: number) => (lon - box.x0) * k * s, Y = (lat: number) => (box.y1 - lat) * s
  const pt = (c: number[]) => `${X(c[0]).toFixed(1)},${Y(c[1]).toFixed(1)}`
  const d = (g: any) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p: number[][][]) => p.map((r) => 'M' + r.map(pt).join('L') + 'Z').join('')).join('')
  const rain7 = (v: FieldView) => v.days.slice(-7).reduce((a, x) => a + x.rain, 0)
  const rainColor = (r: number) => `color-mix(in srgb, var(--rain) ${Math.min(100, 15 + r * 40).toFixed(0)}%, var(--card))`
  const fill = (v: FieldView) => layer === 'water' ? STATUS_COLOR[v.advice.status] : layer === 'rain' ? rainColor(rain7(v)) : CROP_COLOR[v.season?.crop ?? ''] ?? 'var(--fg3)'
  const vw = W / view.k, vh = H / view.k
  const pivots = state.pivots.filter((p) => p.pivot.lat != null && (!farm || p.farm?.id === farm))
  const mPerUnit = 111320 / s // metres per SVG unit (north-south)
  return (
    <div className="page wide">
      <Head title="Map" />
      <CropBar />
      <div className="filters">
        <Seg value={layer} options={[['water', 'Soil water'], ['rain', 'Rain, 7 days'], ['crop', 'Crop']]} onChange={setLayer} />
        <select value={farm} onChange={(e) => { setFarm(e.target.value); setView({ x: 0, y: 0, k: 1 }) }} aria-label="Farm"><option value="">All farms</option>{state.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <button className="btn" onClick={() => setView((v) => ({ ...v, k: Math.min(12, v.k * 1.6) }))} aria-label="Zoom in">+</button>
        <button className="btn" onClick={() => setView((v) => ({ ...v, k: Math.max(1, v.k / 1.6) }))} aria-label="Zoom out">−</button>
      </div>
      <div className="map"
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y } }}
        onPointerMove={(e) => { if (!drag.current) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const f = vw / r.width; setView((v) => ({ ...v, x: drag.current!.vx - (e.clientX - drag.current!.x) * f, y: drag.current!.vy - (e.clientY - drag.current!.y) * f })) }}
        onPointerUp={() => { drag.current = null }} onPointerLeave={() => { drag.current = null }}>
        <svg viewBox={`${(W - vw) / 2 + view.x} ${(H - vh) / 2 + view.y} ${vw} ${vh}`}>
          {imagery && <image href={imagery.url} x={X(imagery.bounds[0])} y={Y(imagery.bounds[3])} width={X(imagery.bounds[2]) - X(imagery.bounds[0])} height={Y(imagery.bounds[1]) - Y(imagery.bounds[3])} preserveAspectRatio="none" />}
          {shapes.map((v) => (
            <path key={v.field.id} d={d(v.field.boundary)} fill={fill(v)} fillOpacity={imagery ? 0.55 : 0.8} onClick={() => push({ kind: 'field', id: v.field.id })}><title>{v.field.name}: {v.advice.line}</title></path>
          ))}
          {pivots.map((p) => {
            const ac = p.acres ?? 0
            const r = ac ? Math.sqrt((ac * 4046.86) / Math.PI) / mPerUnit : 0
            return <g key={p.pivot.id} style={{ pointerEvents: 'none' }}>
              {r > 0 && <circle cx={X(p.pivot.lon!)} cy={Y(p.pivot.lat!)} r={r} fill="none" stroke={p.running ? 'var(--water)' : 'rgba(255,255,255,.75)'} strokeWidth={p.running ? 3 : 1} vectorEffect="non-scaling-stroke" strokeDasharray={p.running ? undefined : '3 3'} />}
              {(view.k >= 2 || farm) && <text x={X(p.pivot.lon!)} y={Y(p.pivot.lat!)} textAnchor="middle" dominantBaseline="middle" style={{ font: `600 ${9 / Math.sqrt(view.k)}px var(--text)`, fill: '#fff', paintOrder: 'stroke', stroke: 'rgba(0,0,0,.55)', strokeWidth: 2 / Math.sqrt(view.k) }}>{p.pivot.name}</text>}
            </g>
          })}
        </svg>
      </div>
      <div className="leg" style={{ margin: '10px 4px' }}>
        {layer === 'water' && <><span><i style={{ background: 'var(--coral)' }} />Turn on today</span><span><i style={{ background: 'var(--amber)' }} />Turn on soon</span><span><i style={{ background: 'var(--leaf)' }} />Hold</span><span><i style={{ background: 'var(--fg3)' }} />Not modeled</span></>}
        {layer === 'rain' && <><span><i style={{ background: rainColor(0) }} />0 in</span><span><i style={{ background: rainColor(1) }} />1 in</span><span><i style={{ background: rainColor(2) }} />2 in or more</span></>}
        {layer === 'crop' && Object.entries(CROP_COLOR).map(([c, col]) => <span key={c}><i style={{ background: col }} />{c}</span>)}
        <span><i style={{ background: 'var(--water)' }} />Running pivot</span>
      </div>
      <p className="note">Tap a field to open it. Drag to move, + and − to zoom; pivot names show when zoomed in or on one farm. {imagery ? `Imagery: ${imagery.label}.` : 'No satellite image loaded for this farm yet.'}</p>
    </div>
  )
}
