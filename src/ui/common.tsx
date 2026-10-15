import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { FarmState, FieldView, PivotView } from '../domain/farm'
import type { Client, Entry } from '../db'
import type { Run } from '../domain/runs'
import { CROP_FILTERS, type CropFilter } from '../domain/crop'
import { CropGlyph } from './brand'

export type SettingsTab = 'users' | 'clients' | 'conn' | 'pivots'
export type Route = { kind: 'field'; id: string } | { kind: 'pivot'; id: string } | { kind: 'import' } | { kind: 'settings'; tab?: SettingsTab } | { kind: 'welcome' }
export interface Nav {
  push: (r: Route) => void
  back: () => void
  turn: (pivotId: string, mode: 'on' | 'off' | 'run') => void
  toast: (msg: string) => void
  state: FarmState // narrowed by the crop filter on the main tabs
  me: string
  crop?: CropFilter
  setCrop?: (c: CropFilter) => void
  canAdmin?: boolean
  clients?: Client[] // the clients this person can pick
  openClients?: () => void
}
export const NavCtx = createContext<Nav>(null as any)
export const useNav = () => useContext(NavCtx)

export const STATUS_PILL: Record<string, string> = { now: 'p-now', soon: 'p-soon', ok: 'p-ok', none: 'p-none', off: 'p-off' }

export const fmtIn = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : `${x.toFixed(d)} in`)
export const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })
export const hoursSince = (iso: string) => (Date.now() - Date.parse(iso)) / 3600000
export const fmtHours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${(h / 24).toFixed(1)} days`)

export function Chevron() {
  return <svg width="8" height="13" viewBox="0 0 8 13" style={{ color: 'var(--fg3)', flex: 'none' }}><path d="M1.5 1.5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export function Ring({ pct, status, size = 44 }: { pct: number; status: string; size?: number }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct))
  const col = status === 'now' ? 'var(--coral)' : status === 'soon' ? 'var(--amber)' : status === 'ok' ? 'var(--leaf)' : 'var(--fg3)'
  return (
    <svg width={size} height={size} style={{ flex: 'none' }} aria-label={`${p.toFixed(0)}% dry`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill)" strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(c * p) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" style={{ font: '700 11.5px var(--round)', fill: 'var(--fg)' }}>{p.toFixed(0)}%</text>
    </svg>
  )
}

export function FieldRow({ v }: { v: FieldView }) {
  const { push } = useNav()
  return (
    <button className="row" onClick={() => push({ kind: 'field', id: v.field.id })}>
      <span className={`dot d-${v.advice.status}`} />
      <span className="t"><b>{v.field.name}</b><span>{[v.season?.crop, v.season ? `${v.season.acres} ac` : null, v.pivot?.name, v.advice.recommendGrossIn ? `put on ${v.advice.recommendGrossIn.toFixed(2)} in` : null].filter(Boolean).join(' · ')}</span></span>
      <span className={`pill ${STATUS_PILL[v.advice.status]}`}>{v.advice.line}</span>
      <Chevron />
    </button>
  )
}

export function PivotRow({ p, sub }: { p: PivotView; sub?: string }) {
  const { push, turn } = useNav()
  const running = p.running
  return (
    <div className="row">
      <button className="t" style={{ textAlign: 'left' }} onClick={() => push({ kind: 'pivot', id: p.pivot.id })}>
        <b>{p.pivot.name}</b>
        <span className={running?.issues.some((i) => i.startsWith('Still')) ? 'warn' : ''}>{sub ?? (running ? runningLine(running) : p.lastRun ? `Last off ${fmtWhen(p.lastRun.stop!)}` : 'No runs logged')}</span>
      </button>
      {running ? <button className="btn off" onClick={() => turn(p.pivot.id, 'off')}>Turn OFF</button> : <button className="btn pri" onClick={() => turn(p.pivot.id, 'on')}>Turn ON</button>}
    </div>
  )
}

export function runningLine(r: Run): string {
  const still = r.issues.find((i) => i.startsWith('Still'))
  if (still) return still
  const parts = [`On ${fmtHours(hoursSince(r.start!))}`, r.direction === 'reverse' ? 'Reverse' : r.direction ? 'Forward' : null, r.percentTimer ? `${r.percentTimer}%` : null]
  if (r.eta) parts.push(Date.parse(r.eta) > Date.now() ? `around about ${fmtClock(r.eta)}` : `should be around since ${fmtClock(r.eta)}`)
  return parts.filter(Boolean).join(' · ')
}
export const fmtClock = (iso: string) => {
  const d = new Date(iso), same = d.toDateString() === new Date().toDateString()
  return d.toLocaleString('en-US', same ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/** One entry in plain words, like "Reverse · 55% · stop at 180°". */
export function describeEntry(e: Entry): string {
  if (e.action === 'void') return 'Cancelled an earlier entry'
  if (e.action === 'note') return e.note ?? 'Note'
  const bits: (string | null)[] = []
  if (e.how === 'agsense') return e.note ?? `AgSense ${e.hours} h`
  if (e.action === 'run') bits.push(`${fmtWhen(e.startAt!)} to ${fmtWhen(e.stopAt!)}`)
  if (e.action !== 'off') {
    bits.push(e.direction === 'reverse' ? 'Reverse' : e.direction === 'forward' ? 'Forward' : null, e.percentTimer ? `${e.percentTimer}%` : null)
    bits.push(e.plannedStop === 'lap' ? 'one lap' : e.plannedStop === 'position' && e.stopDeg != null ? `stop at ${e.stopDeg}°` : e.plannedStop === 'keep' ? 'keep going' : null)
    if (e.endGun) bits.push('end gun on')
  }
  if (e.madeItAround != null) bits.push(e.madeItAround ? 'made it around' : 'stopped part way')
  if (e.note && e.action !== 'run') bits.push(e.note)
  return bits.filter(Boolean).join(' · ')
}

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" role="dialog" onClick={(e) => e.stopPropagation()}><div className="grab" />{children}</div>
    </div>
  )
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="seg">{options.map(([v, l]) => <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => onChange(v)} type="button">{l}</button>)}</div>
}

export function useGeo(): { lat: number; lon: number } | null {
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null)
  useEffect(() => {
    if (!('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition((p) => setPos({ lat: p.coords.latitude, lon: p.coords.longitude }), () => {}, { maximumAge: 60000 })
    return () => navigator.geolocation.clearWatch(id)
  }, [])
  return pos
}

export const milesBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 3958.8, toR = Math.PI / 180
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** All / Cotton / Peanuts / Corn. One glass knob slides to the pick; the choice stays across tabs. */
export function CropBar() {
  const { crop = 'All', setCrop } = useNav()
  if (!setCrop) return null
  return (
    <div className="crops" role="group" aria-label="Crop filter">
      <span className="knob" style={{ '--k': CROP_FILTERS.indexOf(crop) } as any} />
      {CROP_FILTERS.map((c) => <button key={c} type="button" aria-pressed={crop === c} onClick={() => setCrop(c)}><CropGlyph crop={c} />{c}</button>)}
    </div>
  )
}

/** Large page title with the person button on the right (opens Settings). With more than one client,
 * the client's name sits above the title; tap it to switch. */
export function Head({ title, sub }: { title: string; sub?: ReactNode }) {
  const { me, push, clients = [], state, openClients } = useNav()
  const client = clients.length > 1 ? clients.find((c) => c.id === state.clientId) : null
  return (
    <div className="hd">
      <div style={{ minWidth: 0 }}>
        {client && openClients && <button className="clientchip" onClick={openClients} aria-label={`Client: ${client.name}. Switch client`}>{client.name}<svg width="10" height="7" viewBox="0 0 10 7" aria-hidden="true"><path d="M1 1.5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
        <h1>{title}</h1>{sub && <small>{sub}</small>}</div>
      <button className="av" onClick={() => push({ kind: 'settings' })} aria-label="Settings">{(me || '?').trim()[0]?.toUpperCase() ?? '?'}</button>
    </div>
  )
}
