import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { db, getSetting, setSetting } from './db'
import { loadState } from './domain/farm'
import { NavCtx, fmtClock, type Route } from './ui/common'
import { ImportScreen, Settings } from './ui/Import'
import { Reports } from './ui/Reports'
import { FieldDetail, Fields, Log, MapView, PivotDetail, Today } from './ui/screens'
import { TurnSheet } from './ui/TurnSheet'
import { SignIn } from './ui/SignIn'

type Tab = 'today' | 'map' | 'log' | 'fields' | 'reports'
const ICONS: Record<Tab, JSX.Element> = {
  today: <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z" />,
  map: <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />,
  log: <path d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2" />,
  fields: <path d="M4 5h16M4 12h16M4 19h16" />,
  reports: <path d="M6 20V10M12 20V4M18 20v-7" />,
}
const LABELS: Record<Tab, string> = { today: 'Today', map: 'Map', log: 'Log', fields: 'Fields', reports: 'Reports' }

export function App() {
  const state = useLiveQuery(loadState, [])
  const [tab, setTab] = useState<Tab>('today')
  const [stack, setStack] = useState<Route[]>([])
  const [turn, setTurn] = useState<{ pivotId: string; mode: 'on' | 'off' | 'run' } | null>(null)
  const [msg, setMsg] = useState('')
  const [me, setMe] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const people = useLiveQuery(() => db.people.toArray(), [])
  const meId = useLiveQuery(() => db.settings.get('meId'), [])
  useEffect(() => { getSetting('me', '').then(setMe) }, [])
  useEffect(() => { setRole(people?.find((p) => p.id === meId?.value)?.role ?? null) }, [people, meId])
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(''), 2600); return () => clearTimeout(t) } }, [msg])
  useEffect(() => { window.scrollTo(0, 0) }, [tab, stack.length])

  // Lap reminder: an hour before a running pivot should make it around, and when it gets there.
  // In-app (toast, plus a system notification if allowed) while the app is open; texting is on hold.
  const told = useRef<Set<string>>(new Set())
  const [tick, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (!state) return
    for (const p of state.pivots) {
      const r = p.running
      if (!r?.eta) continue
      const left = (Date.parse(r.eta) - Date.now()) / 60000
      const say = (key: string, msg: string) => {
        if (told.current.has(key)) return
        told.current.add(key)
        setMsg(msg)
        try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Pivot Log', { body: msg, tag: key }) } catch { /* not allowed here */ }
      }
      if (left <= 60 && left > 0) say(r.entryIds[0] + ':soon', `${p.pivot.name} will be around about ${fmtClock(r.eta)}. Leave it on or turn it off?`)
      if (left <= 0 && left > -180) say(r.entryIds[0] + ':now', `${p.pivot.name} should be around now. Did it make it?`)
    }
  }, [state, tick])

  const push = useCallback((r: Route) => setStack((s) => [...s, r]), [])
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), [])
  if (!state || !people) return null
  const signedIn = !people.length || people.some((p) => p.id === meId?.value)
  // With no people set up yet (first setup, or the demo) everyone can do everything.
  const canAdmin = !people.length || role === 'office' || role === 'manager'
  if (!signedIn) return <NavCtx.Provider value={{ push: () => {}, back: () => {}, turn: () => {}, toast: setMsg, state, me }}><SignIn onIn={(p) => { setMe(p.name); setRole(p.role) }} /></NavCtx.Provider>
  const top = stack.at(-1)
  const nav = { push, back, turn: (pivotId: string, mode: 'on' | 'off' | 'run') => setTurn({ pivotId, mode }), toast: setMsg, state, me }
  const title = top?.kind === 'field' ? 'Field' : top?.kind === 'pivot' ? 'Pivot' : top?.kind === 'import' ? 'Import' : top?.kind === 'settings' ? 'Settings' : ''

  return (
    <NavCtx.Provider value={nav}>
      {top ? <>
        <div className="page" style={{ paddingBottom: 0, paddingTop: 0 }}>
          <div className="nav"><button className="back" onClick={back}>‹ Back</button><span className="nt">{title}</span><span style={{ width: 60 }} /></div>
        </div>
        {top.kind === 'field' && <FieldDetail id={top.id} />}
        {top.kind === 'pivot' && <PivotDetail id={top.id} />}
        {top.kind === 'import' && (canAdmin ? <ImportScreen /> : <div className="page"><p className="note">Importing is for the office and managers. Ask the office to sign in.</p></div>)}
        {top.kind === 'settings' && <Settings onMe={setMe} canAdmin={canAdmin} signOut={async () => { await setSetting('meId', null); setStack([]) }} />}
      </> : <>
        <div className="page" style={{ paddingBottom: 0, paddingTop: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 'calc(var(--top) + 8px)' }}>
            <button className="btn sm" onClick={() => push({ kind: 'settings' })}>{me || 'Set your name'}{role ? ` · ${role}` : ''}</button>
          </div>
        </div>
        {tab === 'today' && <Today />}
        {tab === 'map' && <MapView />}
        {tab === 'log' && <Log />}
        {tab === 'fields' && <Fields />}
        {tab === 'reports' && <Reports />}
      </>}
      <nav className="tabbar"><div className="in">
        {(Object.keys(LABELS) as Tab[]).map((t) => (
          <button key={t} className={tab === t && !top ? 'on' : ''} onClick={() => { setTab(t); setStack([]) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[t]}</svg>{LABELS[t]}
          </button>))}
      </div></nav>
      {turn && <TurnSheet {...turn} onClose={() => setTurn(null)} />}
      {msg && <div className="toast" role="status">{msg}</div>}
    </NavCtx.Provider>
  )
}
