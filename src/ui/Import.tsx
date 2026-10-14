import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { db, getSetting, setSetting } from '../db'
import { clearAll, loadDemo } from '../domain/farm'
import { readBoundaries, type Shape } from '../import/boundaries'
import { applyFields, parseFieldRows, planFields, type FieldPlan } from '../import/fields'
import { applyPivotInfo, isPivotInfoHeader, planPivotInfo, type PivotPlan } from '../import/pivotInfo'
import { readTable } from '../import/read'
import { importWeather } from '../import/weather'
import { applyAgSense, planAgSense, type AgPlan } from '../import/agsense'
import { importProbes } from '../import/probes'
import { crewLogin, currentSession, emailCode, emailLink, logout, supabase, syncNow } from '../sync'
import { makeReminderKeys, pushState, turnOffPush, turnOnPush, type PushState } from '../push'
import { Seg, useNav } from './common'
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
      <FarmAccount waiting={waiting} />
      {canAdmin && <><div className="sec">Reset</div>
      <button className="cta off" onClick={() => (sure ? clearAll() : setSure(true))}>{sure ? 'Tap again to erase everything' : 'Erase this device'}</button>
      {sure && <p className="note warn">Entries not yet sent will be lost.</p>}</>}
    </div>
  )
}

/** Lap reminders on a locked phone. The office sets up the farm's keys once. */
function Reminders({ office }: { office: boolean }) {
  const { toast, me } = useNav()
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null)
  useEffect(() => { pushState().then(setState) }, [])
  if (!state) return null
  const copy = (v: string) => navigator.clipboard?.writeText(v).then(() => toast('Copied'), () => {})
  const flip = async () => {
    setBusy(true)
    const err = state === 'on' ? (await turnOffPush(), null) : await turnOnPush(me)
    setBusy(false)
    if (err) toast(err)
    setState(await pushState())
  }
  return <>
    <div className="sec">Lap reminders</div>
    {state === 'not-set-up' ? (office ? <>
      <p className="note">Reminders that reach a locked phone need the farm's reminder keys, made once here and kept in Netlify.</p>
      {!keys ? <button className="cta sec2" onClick={async () => setKeys(await makeReminderKeys())}>Make reminder keys</button> : <>
        <div className="card kv">
          <span>VITE_VAPID_PUBLIC_KEY</span><b style={{ wordBreak: 'break-all' }}>{keys.publicKey} <button className="btn sm" onClick={() => copy(keys.publicKey)}>Copy</button></b>
          <span>VAPID_PRIVATE_KEY</span><b style={{ wordBreak: 'break-all' }}>{keys.privateKey} <button className="btn sm" onClick={() => copy(keys.privateKey)}>Copy</button></b>
        </div>
        <p className="note">In Netlify, open pivot-log, then Project configuration, then Environment variables, and add these two, plus SUPABASE_SERVICE_KEY (the Supabase secret key). Then go to Deploys and choose Trigger deploy. Don't send the private key anywhere else. If you leave this screen first, just make new keys.</p>
      </>}
    </> : <p className="note">Reminders that reach a locked phone are not set up yet. The office sets them up here.</p>)
    : state === 'add-to-home' ? <p className="note">On an iPhone, reminders only work from the Home Screen app. In Safari tap Share, then Add to Home Screen, and open Pivot Log from there.</p>
    : state === 'unsupported' ? <p className="note">This browser can't show reminders on a locked screen.</p>
    : state === 'blocked' ? <p className="note warn">Notifications are blocked for Pivot Log. Allow them in the phone's settings, then come back here.</p>
    : <>
      <div className="card kv"><span>On this phone</span><b>{state === 'on' ? 'On' : 'Off'}</b></div>
      <button className={state === 'on' ? 'cta sec2' : 'cta'} disabled={busy} onClick={flip}>{state === 'on' ? 'Turn reminders off on this phone' : 'Turn on lap reminders'}</button>
      <p className="note">An hour before a running pivot should make it around, and when it should be around, every phone with reminders on gets a notice, even locked.</p>
    </>}
  </>
}

/** Sign this device in to the farm's hosted database, and show what has been sent. */
function FarmAccount({ waiting }: { waiting: number }) {
  const { toast } = useNav()
  const [session, setSession] = useState<Session | null>(null)
  const [kind, setKind] = useState<'office' | 'crew'>('office')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [linkSent, setLinkSent] = useState(false)
  const [code, setCode] = useState('')
  const demo = useLiveQuery(() => getSetting('demo', false), [], false)
  const office = useLiveQuery(() => getSetting('officeLogin', false), [], false)
  const lastSync = useLiveQuery(() => getSetting<string | null>('lastSync', null), [], null)
  useEffect(() => {
    if (!supabase) return
    currentSession().then(setSession)
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!supabase) return <>
    <div className="sec">Farm account</div>
    <div className="card kv"><span>On this phone, not sent</span><b>{waiting}</b><span>Hosted database</span><b>Not set up yet</b></div>
    <p className="note">Until the farm's hosted database is set up, everything stays on this device. Don't clear browser data on a phone with unsent entries.</p>
  </>

  async function go() {
    setBusy(true)
    const err = kind === 'office' ? await emailLink(email) : await crewLogin(email, password)
    setBusy(false)
    if (err) return toast(err)
    if (kind === 'office') setLinkSent(true)
    else { setPassword(''); toast('This phone is signed in') }
  }

  return <>
    <div className="sec">Farm account</div>
    {session ? <>
      <div className="card kv">
        <span>Signed in</span><b>{session.user.email}</b>
        <span>Login</span><b>{office ? 'Office' : 'Crew phone'}</b>
        <span>On this phone, not sent</span><b>{waiting}</b>
        <span>Last synced</span><b>{lastSync ? new Date(lastSync).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not yet'}</b>
      </div>
      {demo && <p className="note warn">Demo data is loaded, so nothing is sent or received. Erase this device to start with the farm's data.</p>}
      <button className="cta sec2" disabled={busy} onClick={async () => { setBusy(true); const r = await syncNow(); setBusy(false); toast(r.error ?? `Sent ${r.sent}, received ${r.received}${r.listsSent ? `, ${r.listsSent} list rows updated` : ''}`) }}>Sync now</button>
      <button className="cta sec2" onClick={() => logout()}>Sign this device out</button>
      <Reminders office={!!office} />
      {waiting > 0 && <p className="note warn">Sign out only after unsent entries have gone up.</p>}
    </> : <>
      <div className="card form">
        <div className="row"><label>This device is</label><Seg value={kind} options={[['office', 'Office'], ['crew', 'A crew phone']]} onChange={(v) => { setKind(v); setLinkSent(false) }} /></div>
        <div className="row"><label htmlFor="fa-email">{kind === 'office' ? 'Your email' : 'Crew login email'}</label><input id="fa-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        {kind === 'crew' && <div className="row"><label htmlFor="fa-pw">Crew password</label><input id="fa-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>}
      </div>
      <button className="cta" disabled={busy || !email.trim() || (kind === 'crew' && !password)} onClick={go}>{kind === 'office' ? 'Email me a sign-in link' : 'Sign this phone in'}</button>
      {linkSent && <>
        <div className="card form" style={{ marginTop: 10 }}>
          <div className="row"><label htmlFor="fa-code">Code from the email</label><input id="fa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" /></div>
        </div>
        <button className="cta" disabled={busy || code.length < 6} onClick={async () => { setBusy(true); const err = await emailCode(email, code); setBusy(false); if (err) toast(err); else { setCode(''); toast('Signed in') } }}>Sign in with the code</button>
        <p className="note">Check {email}. Type the code here, or open the link on this same device. On an iPhone home-screen app, use the code.</p>
      </>}
      <p className="note">{kind === 'office' ? 'The first email-link sign-in becomes the office login. Office devices send the field, pivot and people lists to every phone.' : 'The office sets this up once on each crew phone. People then pick their name and PIN as usual.'} Waiting to send: {waiting}.</p>
    </>}
  </>
}
