import { useMemo, useState } from 'react'
import { db, uid, type Entry, type PlannedStop } from '../db'
import { flow, hoursPerPass, inchesFrom } from '../domain/pivot'
import { stopHours } from '../domain/runs'
import { Seg, Sheet, fmtHours, fmtWhen, hoursSince, useNav } from './common'

const localInput = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

/** Turn ON, Turn OFF, or log a past run. Every save is a new entry; nothing is overwritten. */
export function TurnSheet({ pivotId, mode, onClose }: { pivotId: string; mode: 'on' | 'off' | 'run'; onClose: () => void }) {
  const { state, me, toast } = useNav()
  const pv = state.pivots.find((p) => p.pivot.id === pivotId)!
  const lastOn = useMemo(() => state.entries.filter((e) => e.pivotId === pivotId && (e.action === 'on' || e.action === 'run')).sort((a, b) => b.happenedAt.localeCompare(a.happenedAt))[0], [state.entries, pivotId])
  const [when, setWhen] = useState<'now' | 'earlier'>('now')
  const [at, setAt] = useState(localInput())
  const [startAt, setStartAt] = useState(localInput(new Date(Date.now() - 24 * 3600000)))
  const [direction, setDirection] = useState<'forward' | 'reverse'>((lastOn?.direction as any) ?? 'forward')
  const [pct, setPct] = useState<number>(lastOn?.percentTimer ?? 50)
  const [stop, setStop] = useState<PlannedStop>(lastOn?.plannedStop ?? 'lap')
  const [startDeg, setStartDeg] = useState<string>('')
  const [stopDeg, setStopDeg] = useState<string>('')
  const [endGun, setEndGun] = useState<boolean>(lastOn?.endGun ?? false)
  const [around, setAround] = useState<boolean | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const f = flow(pv.pivot)
  const pass = hoursPerPass(pv.pivot, pct, pv.lapHours100?.hours ?? null)
  const perPass = pass && f && pv.acres ? inchesFrom(f.gpm, pass, pv.acres) : null
  const toStop = stopHours({ plannedStop: stop, direction, startDeg: startDeg === '' ? null : Number(startDeg), stopDeg: stopDeg === '' ? null : Number(stopDeg) }, pass)
  const startMs = when === 'now' ? Date.now() : Date.parse(at)
  const running = pv.running
  const offHours = running ? (when === 'now' ? hoursSince(running.start!) : (Date.parse(at) - Date.parse(running.start!)) / 3600000) : null

  async function save() {
    setSaving(true)
    const coords = await new Promise<GeolocationCoordinates | null>((res) => {
      if (!('geolocation' in navigator)) return res(null)
      navigator.geolocation.getCurrentPosition((p) => res(p.coords), () => res(null), { timeout: 4000, maximumAge: 120000 })
    })
    const now = new Date().toISOString()
    const base: Entry = {
      id: uid(), pivotId, action: mode, happenedAt: when === 'now' ? now : new Date(at).toISOString(), recordedAt: now, who: me || 'Unknown',
      how: 'app', lat: coords?.latitude ?? null, lon: coords?.longitude ?? null, note: note || null, synced: 0,
    }
    if (mode === 'on' || mode === 'run') Object.assign(base, {
      direction, percentTimer: pct, plannedStop: stop, endGun,
      startDeg: startDeg === '' ? null : Number(startDeg), stopDeg: stop === 'position' && stopDeg !== '' ? Number(stopDeg) : null,
    })
    if (mode === 'off' || mode === 'run') base.madeItAround = around
    if (mode === 'run') { base.startAt = new Date(startAt).toISOString(); base.stopAt = new Date(at).toISOString(); base.happenedAt = base.stopAt; base.how = 'office' }
    if (mode === 'run' && Date.parse(base.stopAt!) <= Date.parse(base.startAt!)) { setSaving(false); toast('Stop must be after start'); return }
    await db.entries.add(base)
    // Ask once for notifications so the lap reminder can reach the lock screen while the app is open.
    if (mode === 'on' && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
    toast(mode === 'on' ? `${pv.pivot.name} on` : mode === 'off' ? `${pv.pivot.name} off` : 'Run saved')
    onClose()
  }

  const title = mode === 'on' ? `Turn on · ${pv.pivot.name}` : mode === 'off' ? `Turn off · ${pv.pivot.name}` : `Log a past run · ${pv.pivot.name}`
  return (
    <Sheet onClose={onClose}>
      <h2>{title}</h2>
      <p className="sub">{pv.fields.map((x) => x.name).join(', ') || 'No fields linked'}{pv.acres ? ` · ${pv.acres.toFixed(0)} ac` : ''}</p>

      <div className="card form">
        {mode === 'run' && <div className="row"><label>Started</label><input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></div>}
        {mode !== 'run' && <div className="row"><label>When</label><Seg value={when} options={[['now', 'Now'], ['earlier', 'Earlier']]} onChange={setWhen} /></div>}
        {(when === 'earlier' || mode === 'run') && <div className="row"><label>{mode === 'run' ? 'Stopped' : mode === 'on' ? 'Started at' : 'Stopped at'}</label><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></div>}
        {mode !== 'off' && <>
          <div className="row"><label>Direction</label><Seg value={direction} options={[['forward', 'Forward'], ['reverse', 'Reverse']]} onChange={setDirection} /></div>
          <div className="row"><label>Percent timer</label><input type="number" inputMode="numeric" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} style={{ width: 80 }} /></div>
          {mode === 'on' && <>
            <div className="row"><label>Stop</label><Seg value={stop} options={[['lap', 'One lap'], ['position', 'At position'], ['keep', 'Keep going']]} onChange={setStop} /></div>
            {stop === 'position' && <>
              <div className="row"><label>Starting at (°)</label><input type="number" inputMode="numeric" min={0} max={359} value={startDeg} onChange={(e) => setStartDeg(e.target.value)} style={{ width: 80 }} /></div>
              <div className="row"><label>Stop at (°)</label><input type="number" inputMode="numeric" min={0} max={359} value={stopDeg} onChange={(e) => setStopDeg(e.target.value)} style={{ width: 80 }} /></div>
            </>}
          </>}
          <div className="row"><label>End gun</label><Seg value={endGun ? 'y' : 'n'} options={[['n', 'Off'], ['y', 'On']]} onChange={(v) => setEndGun(v === 'y')} /></div>
        </>}
        {mode !== 'on' && <div className="row"><label>Made it around?</label><Seg value={around === null ? '' : around ? 'y' : 'n'} options={[['y', 'Made it around'], ['n', 'Stopped part way']]} onChange={(v) => setAround(v === 'y')} /></div>}
        <div className="row"><label>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></div>
      </div>

      {mode === 'on' && <div className="calc">
        {perPass !== null ? <>Puts on about <b>{perPass.toFixed(2)} in</b> per lap. </> : null}
        {pass ? <>A lap takes about <b>{fmtHours(pass)}</b>{pv.lapHours100 && !pv.pivot.profile.hoursPerRev100 ? ' (learned from past laps)' : ''}. </> : <span className="warn">No lap time yet. Mark "made it around" when it does, and the app learns it. </span>}
        {toStop ? <>Should stop about <b>{fmtWhen(new Date(startMs + toStop * 3600000).toISOString())}</b>.</> : null}
        {!f && <div className="warn">No flow rate for this pivot yet, so inches can't be worked out.</div>}
      </div>}
      {mode === 'off' && running && <div className="calc">
        On since <b>{fmtWhen(running.start!)}</b>, <b>{fmtHours(Math.max(0, offHours!))}</b>
        {f && pv.acres ? <> · about <b>{inchesFrom(f.gpm, Math.max(0, offHours!), pv.acres).toFixed(2)} in</b></> : null}
      </div>}
      {mode === 'off' && !running && <div className="calc warn">No ON logged for this pivot. The OFF will be saved and listed as a gap to fill.</div>}

      <button className={`cta ${mode === 'off' ? 'off' : ''}`} disabled={saving} onClick={save}>
        {mode === 'on' ? (when === 'now' ? 'Turn on now' : 'Save start') : mode === 'off' ? (when === 'now' ? 'Turn off now' : 'Save stop') : 'Save run'}
      </button>
      <button className="cta sec2" onClick={onClose}>Cancel</button>
    </Sheet>
  )
}
