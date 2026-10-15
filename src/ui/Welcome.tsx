import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db, setSetting } from '../db'
import { num } from '../domain/pivot'
import { currentSession } from '../sync'
import { Count, Logo } from './brand'
import { Chevron, useNav, type Route } from './common'

// First screen for the office until setup is done: "Welcome, Bo", five steps with what each one is
// for, and the next one to do. "Skip for now" hides it; Settings, Users, Setup steps brings it back.

interface Step { title: string; done: boolean; sub: string; status?: string; go: Route }

export function Welcome({ onDone }: { onDone: () => void }) {
  const { state, me, push } = useNav()
  const people = useLiveQuery(() => db.people.count(), [], 0)
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => { currentSession().then((s) => setSignedIn(!!s)) }, [])
  const acres = state.fields.reduce((s, f) => s + (f.season?.acres ?? 0), 0)
  const placed = state.pivots.filter((p) => p.pivot.lat != null).length
  const withFlow = state.pivots.filter((p) => num(p.pivot, 'flowGpm') ?? num(p.pivot, 'measuredGpm')).length
  const steps: Step[] = [
    { title: 'Farms and fields', done: state.fields.length > 0, sub: state.fields.length ? `${state.fields.length} fields, ${Math.round(acres).toLocaleString()} acres` : 'Field list and boundaries, from Field Master or the crop plan', go: { kind: 'import' } },
    { title: 'Pivots', done: state.pivots.length > 0 && placed === state.pivots.length, sub: state.pivots.length ? `${placed} of ${state.pivots.length} pivots placed on the map` : 'Come in with the field list', status: state.pivots.length && placed < state.pivots.length ? `${placed}/${state.pivots.length}` : undefined, go: { kind: 'import' } },
    { title: 'Pivot info', done: state.pivots.length > 0 && withFlow === state.pivots.length, sub: 'gpm, lap time and sprinkler chart, so the app can figure inches', status: state.pivots.length ? `${withFlow}/${state.pivots.length}` : undefined, go: { kind: 'settings', tab: 'pivots' } },
    { title: 'Invite your people', done: people > 1, sub: 'Office by email, crew by PIN', go: { kind: 'settings', tab: 'users' } },
    { title: 'Connect data', done: signedIn && !!state.weatherSource, sub: 'Farm account, AgSense, radar rain, weather for ET', go: { kind: 'settings', tab: 'conn' } },
  ]
  const n = steps.filter((s) => s.done).length
  const next = steps.findIndex((s) => !s.done)
  const first = (me || '').trim().split(/\s+/)[0]
  return (
    <div className="page">
      <div className="wel">
        <div className="mark"><Logo animate size={100} /></div>
        <h1>Welcome{first ? `, ${first}` : ''}</h1>
        <p>{n === 5 ? 'Everything is set up. You can come back here from Settings.' : `Let's get the farm ready. ${n ? `${n} ${n === 1 ? 'step' : 'steps'} done, ${5 - n} to go.` : 'Five steps, in this order.'}`}</p>
      </div>
      <div className="prog" role="progressbar" aria-valuemin={0} aria-valuemax={5} aria-valuenow={n} aria-label={`${n} of 5 steps done`}><i style={{ width: `${(n / 5) * 100}%` }} /></div>
      <div className="card steps">{steps.map((s, i) => (
        <button key={s.title} className={'step' + (s.done ? ' done' : i === next ? ' next' : '')} onClick={() => push(s.go)}>
          <span className="k">{s.done ? <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5.5 12.5 4.2 4.2 8.8-9" /></svg> : i + 1}</span>
          <span><b>{s.title}</b><span>{s.sub}</span></span>
          <span className="s">{s.done ? 'Done' : i === next ? 'Next' : s.status ?? <Chevron />}</span>
        </button>))}
      </div>
      {next >= 0 && <button className="cta" onClick={() => push(steps[next].go)}>Continue: {steps[next].title}</button>}
      <button className="cta ghost" onClick={async () => { await setSetting('welcomeDone', true); onDone() }}>{n === 5 ? 'Go to Today' : 'Skip for now'}</button>
      {state.fields.length > 0 && <p className="note" style={{ textAlign: 'center' }}><Count to={state.pivots.length} /> pivots, <Count to={state.fields.length} /> fields so far.</p>}
    </div>
  )
}
