import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { db, getSetting, setSetting } from '../db'
import { clearAll } from '../domain/farm'
import { pivotStatus } from '../domain/crop'
import { num } from '../domain/pivot'
import { currentSession, supabase, syncNow } from '../sync'
import { pushState, type PushState } from '../push'
import { CropGlyph, SyncIcon } from './brand'
import { Chevron, useNav, type SettingsTab } from './common'
import { FarmAccount } from './Import'
import { Users } from './Users'

// Settings in three parts: Users (people and roles), Connections (what feeds the app and when it last
// ran, plus this phone's sign-in), and Pivot Info (every pivot's details in one table).

export function Settings({ tab, onMe, signOut, canAdmin }: { tab?: SettingsTab; onMe: (name: string) => void; signOut: () => void; canAdmin: boolean }) {
  const { state } = useNav()
  const [t, setT] = useState<SettingsTab>(tab ?? 'users')
  return (
    <div className="page">
      <div className="hd"><div><h1>Settings</h1><small>{state.farms.length} farms · {state.pivots.length} pivots · {state.fields.length} fields</small></div></div>
      <div className="seg big" role="group" aria-label="Settings section">
        {([['users', 'Users'], ['conn', 'Connections'], ['pivots', 'Pivot Info']] as [SettingsTab, string][]).map(([k, l]) =>
          <button key={k} type="button" className={t === k ? 'on' : ''} aria-pressed={t === k} onClick={() => setT(k)}>{l}</button>)}
      </div>
      <div className="enter" key={t}>
        {t === 'users' && <UsersTab canAdmin={canAdmin} onMe={onMe} signOut={signOut} />}
        {t === 'conn' && <Connections canAdmin={canAdmin} />}
        {t === 'pivots' && <PivotInfo canAdmin={canAdmin} />}
      </div>
    </div>
  )
}

function UsersTab({ canAdmin, onMe, signOut }: { canAdmin: boolean; onMe: (n: string) => void; signOut: () => void }) {
  const { me, push } = useNav()
  const hasPeople = useLiveQuery(() => db.people.count(), [], 0) > 0
  const [name, setName] = useState(me)
  return <>
    <Users canAdmin={canAdmin} />
    <div className="sec">This phone</div>
    <div className="card form">
      {hasPeople ? <div className="row"><label>Signed in as</label><b>{me}</b></div>
        : <div className="row"><label htmlFor="me">Your name</label><input id="me" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { setSetting('me', name); onMe(name) }} placeholder="Shown on every entry" /></div>}
    </div>
    {hasPeople && <button className="cta sec2" onClick={signOut}>Switch person</button>}
    {canAdmin && <button className="cta sec2" onClick={() => push({ kind: 'welcome' })}>Setup steps</button>}
  </>
}

const ago = (iso: string | null | undefined) => {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const daysOld = (date: string | null | undefined) => (date ? (Date.now() - Date.parse(date.slice(0, 10) + 'T12:00:00')) / 86400000 : Infinity)

function Conn({ logo, bg, title, sub, pill, cls, onClick, spin, i }: { logo: ReactNode; bg: string; title: string; sub: string; pill: string; cls: string; onClick?: () => void; spin?: boolean; i: number }) {
  const body = <><span className={'lg' + (spin ? ' busy' : '')} style={{ background: bg }}>{logo}</span><span className="t"><b>{title}</b><span>{sub}</span></span><span className={'pill ' + cls}>{pill}</span>{onClick && <Chevron />}</>
  return onClick ? <button className="row stag" style={{ '--i': i } as any} onClick={onClick}>{body}</button> : <div className="row stag" style={{ '--i': i } as any}>{body}</div>
}

function Connections({ canAdmin }: { canAdmin: boolean }) {
  const { state, push, toast } = useNav()
  const waiting = useLiveQuery(() => db.entries.where('synced').equals(0).count(), [], 0)
  const lastSync = useLiveQuery(() => getSetting<string | null>('lastSync', null), [], null)
  const lastAg = useLiveQuery(() => db.imports.orderBy('at').reverse().filter((i) => i.kind === 'AgSense').first(), [])
  const rainLast = useLiveQuery(async () => (await db.rain.orderBy('date').last()) ?? null, [], null)
  const probes = useLiveQuery(async () => ({ n: await db.probes.count(), last: (await db.probes.orderBy('date').last())?.date ?? null }), [], { n: 0, last: null })
  const [email, setEmail] = useState<string | null>(null)
  const [push_, setPush] = useState<PushState | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [asOf, setAsOf] = useState(state.asOf)
  const [sure, setSure] = useState(false)
  useEffect(() => { currentSession().then((s) => setEmail(s?.user.email ?? null)); pushState().then(setPush) }, [])
  const ag = state.pivots.filter((p) => p.pivot.agsenseName).length
  const est = /est/i.test(state.weatherSource)
  const sync = async () => {
    if (!email) return toast('Sign this phone in to the farm account below first.')
    setSyncing(true)
    const r = await syncNow()
    setSyncing(false)
    toast(r.error ?? `Synced. Sent ${r.sent}, received ${r.received}`)
  }
  const rows = [
    { logo: 'AS', bg: '#3a7d44', title: 'AgSense 365', sub: `${ag} pivots on AgSense · weekly CSV${lastAg ? `, last import ${ago(lastAg.at)}` : ', none imported yet'}`, pill: lastAg ? 'On' : 'Not yet', cls: lastAg ? 'p-ok' : 'p-off', onClick: canAdmin ? () => push({ kind: 'import' }) : undefined },
    { logo: 'R', bg: 'var(--rain)', title: 'Radar rain (NOAA)', sub: rainLast ? `Every pivot · nightly · last day ${ago(rainLast.date)}` : 'Every pivot · nightly · nothing received yet', pill: daysOld(rainLast?.date) <= 3 ? 'On' : rainLast ? 'Behind' : 'Not yet', cls: daysOld(rainLast?.date) <= 3 ? 'p-ok' : 'p-soon' },
    { logo: 'ET', bg: '#b8862a', title: 'Weather for ET', sub: state.weatherSource ? `${state.weatherSource}${state.weatherTo ? ` · to ${ago(state.weatherTo)}` : ''}${est ? '. UGA station once the link comes' : ''}` : 'Nothing loaded yet', pill: !state.weatherSource ? 'Not yet' : est ? 'Interim' : 'On', cls: !state.weatherSource ? 'p-off' : est ? 'p-soon' : 'p-ok' },
    { logo: <SyncIcon />, bg: '#5f6f7a', title: 'Cloud sync', sub: !supabase ? 'Not set up; everything stays on this phone' : email ? `${syncing ? 'Syncing…' : lastSync ? `Last synced ${new Date(lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Not synced yet'}${waiting ? ` · ${waiting} waiting to send` : ''}` : 'This phone is not signed in', pill: email ? 'On' : 'Off', cls: email ? 'p-ok' : 'p-off', onClick: supabase ? sync : undefined, spin: syncing },
    { logo: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>, bg: 'var(--water)', title: 'Lap reminders', sub: push_ === 'on' ? 'On for this phone, even locked' : push_ === 'not-set-up' ? 'Not set up for the farm yet' : push_ === 'add-to-home' ? 'Add the app to the Home Screen first' : push_ === 'blocked' ? 'Blocked in the phone settings' : 'Off on this phone', pill: push_ === 'on' ? 'On' : 'Off', cls: push_ === 'on' ? 'p-ok' : 'p-off' },
    { logo: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M12 3v13" /><path d="M8.5 16h7l-3.5 5z" fill="#fff" /><path d="M15 7h3M15 10.5h3" /></svg>, bg: 'var(--leaf)', title: 'Soil probes', sub: probes.n ? `${probes.n} readings · last ${ago(probes.last)}` : 'None yet. Probe CSVs load on the Import screen', pill: probes.n ? 'On' : 'Not yet', cls: probes.n ? 'p-ok' : 'p-off', onClick: canAdmin ? () => push({ kind: 'import' }) : undefined },
  ]
  return <>
    <div className="card conn">{rows.map((r, i) => <Conn key={r.title} i={i} {...r} />)}</div>
    {canAdmin && <button className="cta sec2" onClick={() => push({ kind: 'import' })}>Import files</button>}
    <p className="note">Each connection shows what it feeds, when it last ran, and what it is waiting on. Tap Cloud sync to sync now.</p>
    <FarmAccount waiting={waiting} />
    <div className="sec">This phone</div>
    <div className="card form">
      <div className="row"><label htmlFor="asof">Water balance as of</label><input id="asof" type="date" value={asOf} onChange={(e) => { setAsOf(e.target.value); setSetting('asOf', e.target.value || null) }} /></div>
    </div>
    <p className="note">Leave "as of" on today for the season. The demo sets it to July 16, 2026.</p>
    {canAdmin && <>
      <button className="cta off" onClick={() => (sure ? clearAll() : setSure(true))}>{sure ? 'Tap again to erase everything' : 'Erase this device'}</button>
      {sure && <p className="note warn">Entries not yet sent will be lost.</p>}
    </>}
  </>
}

function PivotInfo({ canAdmin }: { canAdmin: boolean }) {
  const { state, push } = useNav()
  const [q, setQ] = useState('')
  const rows = state.pivots.filter((p) => !q || p.pivot.name.toLowerCase().includes(q.toLowerCase()) || p.farm?.name.toLowerCase().includes(q.toLowerCase()))
  const withFlow = state.pivots.filter((p) => num(p.pivot, 'flowGpm') ?? num(p.pivot, 'measuredGpm')).length
  const need = <span className="need">Needed</span>
  return <>
    <div className="srch">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${state.pivots.length} pivots`} aria-label="Search pivots" />
      {canAdmin && <button className="btn pri" onClick={() => push({ kind: 'import' })}>Import sheet</button>}
    </div>
    {state.pivots.length ? <div className="card tbl pinfo"><table>
      <thead><tr><th>Pivot</th><th>Crop</th><th className="n">Acres</th><th>Make</th><th className="n">gpm</th><th className="n">Lap h at 100%</th><th>End gun</th><th>Flow from</th></tr></thead>
      <tbody>{rows.map((p) => {
        const gpm = num(p.pivot, 'measuredGpm') ?? num(p.pivot, 'flowGpm')
        const src = p.pivot.profile.measuredGpm?.source ?? p.pivot.profile.flowGpm?.source
        const c = pivotStatus(p, state.fields).crop
        const gun = p.pivot.profile.endGun?.value
        return <tr key={p.pivot.id} onClick={() => push({ kind: 'pivot', id: p.pivot.id })} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && push({ kind: 'pivot', id: p.pivot.id })}>
          <td>{p.pivot.name}</td>
          <td>{c ? <span className="cc"><CropGlyph crop={c} />{c}</span> : <span className="dim">None</span>}</td>
          <td className="n">{p.acres ? Math.round(p.acres) : need}</td>
          <td>{p.pivot.profile.make ? String(p.pivot.profile.make.value) : need}</td>
          <td className="n">{gpm ?? need}</td>
          <td className="n">{p.lapHours100 ? p.lapHours100.hours.toFixed(1) : need}</td>
          <td>{gun != null ? String(gun) : <span className="dim">–</span>}</td>
          <td>{src ?? <span className="dim">–</span>}</td>
        </tr>
      })}</tbody>
    </table></div> : <p className="note">No pivots yet. Import fields and the pivot info sheet first.</p>}
    <p className="note">{withFlow} of {state.pivots.length} pivots have a flow rate, which the app needs to figure inches. Slide the table sideways for more columns. Tap a row to open the pivot and photograph its sprinkler chart. The pivot info sheet imports in the same layout.</p>
  </>
}
