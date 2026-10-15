import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { db, getSetting, setSetting } from './db'
import { loadState } from './domain/farm'
import { NavCtx, fmtClock, type Route } from './ui/common'
import { ImportScreen } from './ui/Import'
import { Settings } from './ui/Settings'
import { Welcome } from './ui/Welcome'
import { LapRing } from './ui/brand'
import { CROP_FILTERS, filterState, type CropFilter } from './domain/crop'
import { Reports } from './ui/Reports'
import { FieldDetail, Fields, Log, MapView, PivotDetail, Today } from './ui/screens'
import { TurnSheet } from './ui/TurnSheet'
import { SignIn } from './ui/SignIn'
import { fileReminders } from './push'
import { lapReminders } from './reminders'

type Tab = 'today' | 'map' | 'log' | 'fields' | 'reports'
const ICONS: Record<Tab, JSX.Element> = {
  today: <><circle cx="12" cy="12" r="8.5" /><path d="M12 12 7 7" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /></>,
  map: <><path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z" /><path d="M9 4.5v13M15 6.5v13" /></>,
  log: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  fields: <><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="3.75" /><rect x="13" y="3.5" width="7.5" height="7.5" rx="3.75" /><rect x="3.5" y="13" width="7.5" height="7.5" rx="3.75" /><rect x="13" y="13" width="7.5" height="7.5" rx="3.75" /></>,
  reports: <path d="M6 20V11M12 20V5M18 20v-6" />,
}
const LABELS: Record<Tab, string> = { today: 'Today', map: 'Map', log: 'Log', fields: 'Fields', reports: 'Reports' }

export function App() {
  const state = useLiveQuery(loadState, [])
  const [tab, setTab] = useState<Tab>('today')
  const [stack, setStack] = useState<Route[]>([])
  const [turn, setTurn] = useState<{ pivotId: string; mode: 'on' | 'off' | 'run' } | null>(null)
  const [msg, setMsg] = useState('')
  const [banner, setBanner] = useState<{ title: string; body: string; pivotId: string; soon: boolean } | null>(null)
  const [crop, setCropState] = useState<CropFilter>('All')
  const welcomeDone = useLiveQuery(() => getSetting('welcomeDone', false), [], true)
  useEffect(() => { getSetting<CropFilter>('cropFilter', 'All').then((c) => setCropState(CROP_FILTERS.includes(c) ? c : 'All')) }, [])
  const setCrop = useCallback((c: CropFilter) => { setCropState(c); setSetting('cropFilter', c) }, [])
  useEffect(() => { if (banner) { const t = setTimeout(() => setBanner(null), 8000); return () => clearTimeout(t) } }, [banner])
  const [me, setMe] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const people = useLiveQuery(() => db.people.toArray(), [])
  const meId = useLiveQuery(() => db.settings.get('meId'), [])
  useEffect(() => { getSetting('me', '').then(setMe) }, [])
  useEffect(() => { setRole(people?.find((p) => p.id === meId?.value)?.role ?? null) }, [people, meId])
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(''), 2600); return () => clearTimeout(t) } }, [msg])
  useEffect(() => { window.scrollTo(0, 0) }, [tab, stack.length, welcomeDone])

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
        setBanner({ title: key.endsWith(':soon') ? `${p.pivot.name} is almost around` : `${p.pivot.name} should be around`, body: msg, pivotId: p.pivot.id, soon: key.endsWith(':soon') })
        try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Pivot Log', { body: msg, tag: key }) } catch { /* not allowed here */ }
      }
      if (left <= 60 && left > 0) say(r.entryIds[0] + ':soon', `${p.pivot.name} will be around about ${fmtClock(r.eta)}. Leave it on or turn it off?`)
      if (left <= 0 && left > -180) say(r.entryIds[0] + ':now', `${p.pivot.name} should be around now. Did it make it?`)
    }
  }, [state, tick])
  // The same reminders, filed with the farm database so they reach locked phones (src/push.ts).
  useEffect(() => {
    if (!state) return
    fileReminders(state.pivots.flatMap((p) => p.running?.eta ? lapReminders(p.pivot.id, p.pivot.name, p.running.entryIds[0], p.running.eta, fmtClock) : [])).catch(() => {})
  }, [state, tick])

  const push = useCallback((r: Route) => setStack((s) => [...s, r]), [])
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), [])
  if (!state || !people) return null
  const signedIn = !people.length || people.some((p) => p.id === meId?.value)
  // With no people set up yet (first setup, or the demo) everyone can do everything.
  const canAdmin = !people.length || role === 'office' || role === 'manager'
  if (!signedIn) return <NavCtx.Provider value={{ push: () => {}, back: () => {}, turn: () => {}, toast: setMsg, state, me }}><SignIn onIn={(p) => { setMe(p.name); setRole(p.role) }} /></NavCtx.Provider>
  const top = stack.at(-1)
  // Viewers only look; the database refuses their entries too (supabase/migrations/0003_viewers.sql).
  const doTurn = (pivotId: string, mode: 'on' | 'off' | 'run') => role === 'viewer' ? setMsg('Viewers can look but not turn pivots on or off.') : setTurn({ pivotId, mode })
  const full = { push, back, turn: doTurn, toast: setMsg, state, me, crop, setCrop, canAdmin }
  // The crop filter narrows the main tabs; a pivot, field or settings page always shows the whole farm.
  const nav = top ? full : { ...full, state: filterState(state, crop) }
  const title = top?.kind === 'field' ? 'Field' : top?.kind === 'pivot' ? 'Pivot' : top?.kind === 'import' ? 'Import' : top?.kind === 'settings' ? 'Settings' : top?.kind === 'welcome' ? 'Setup' : ''
  const welcome = !top && canAdmin && !welcomeDone

  return (
    <NavCtx.Provider value={nav}>
      {top ? <>
        <div className="page" style={{ paddingBottom: 0, paddingTop: 0 }}>
          <div className="nav"><button className="back" onClick={back}>‹ Back</button><span className="nt">{title}</span><span style={{ width: 60 }} /></div>
        </div>
        {top.kind === 'field' && <FieldDetail id={top.id} />}
        {top.kind === 'pivot' && <PivotDetail id={top.id} />}
        {top.kind === 'import' && (canAdmin ? <ImportScreen /> : <div className="page"><p className="note">Importing is for the office and managers. Ask the office to sign in.</p></div>)}
        {top.kind === 'settings' && <Settings key={top.tab ?? ''} tab={top.tab} onMe={setMe} canAdmin={canAdmin} signOut={async () => { await setSetting('meId', null); setStack([]) }} />}
        {top.kind === 'welcome' && <Welcome onDone={() => setStack([])} />}
      </> : welcome ? <Welcome onDone={() => {}} /> : <>
        {tab === 'today' && <Today />}
        {tab === 'map' && <MapView />}
        {tab === 'log' && <Log />}
        {tab === 'fields' && <Fields />}
        {tab === 'reports' && <Reports />}
      </>}
      {!welcome && <nav className="tabbar"><div className="in">
        {(Object.keys(LABELS) as Tab[]).map((t) => (
          <button key={t} className={tab === t && !top ? 'on' : ''} aria-current={tab === t && !top ? 'page' : undefined} onClick={() => { setTab(t); setStack([]) }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[t]}</svg>{LABELS[t]}
          </button>))}
      </div></nav>}
      {turn && <NavCtx.Provider value={full}><TurnSheet {...turn} onClose={() => setTurn(null)} /></NavCtx.Provider>}
      {banner && <button className="banner" aria-live="polite" onClick={() => { setStack([{ kind: 'pivot', id: banner.pivotId }]); setBanner(null) }}>
        <LapRing frac={banner.soon ? 0.88 : 1} ok check={!banner.soon} size={36} /><span><b>{banner.title}</b><span>{banner.body}</span></span><small>now</small>
      </button>}
      {msg && <div className="toast" role="status" key={msg}>{msg}</div>}
    </NavCtx.Provider>
  )
}
