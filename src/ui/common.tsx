import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { FarmState, FieldView, PivotView } from '../domain/farm'

export type Route = { kind: 'field'; id: string } | { kind: 'pivot'; id: string } | { kind: 'import' } | { kind: 'settings' }
export interface Nav {
  push: (r: Route) => void
  back: () => void
  turn: (pivotId: string, mode: 'on' | 'off' | 'run') => void
  toast: (msg: string) => void
  state: FarmState
  me: string
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
        <span>{sub ?? (running ? `ON ${fmtHours(hoursSince(running.start!))}${running.percentTimer ? ` · ${running.percentTimer}%` : ''}` : p.lastRun ? `Last off ${fmtWhen(p.lastRun.stop!)}` : 'No runs logged')}</span>
      </button>
      {running ? <button className="btn off" onClick={() => turn(p.pivot.id, 'off')}>Turn OFF</button> : <button className="btn pri" onClick={() => turn(p.pivot.id, 'on')}>Turn ON</button>}
    </div>
  )
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
