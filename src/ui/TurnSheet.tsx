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
  const [stop, setStop] = useState<PlannedStop>('lap') // one lap unless changed
  const [startDeg, setStartDeg] = useState<string>('')
  const [stopDeg, setStopDeg] = useState<string>('')
  const endGun = true // Bo, Oct 14: the end gun always runs
  const [more, setMore] = useState(false)
  const [starting, setStarting] = useState(false)
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

  let startedTap = Date.now()
  async function save() {
    setSaving(true)
    startedTap = Date.now()
    if (mode === 'on') setStarting(true)
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
    if (mode === 'on') await new Promise((r) => setTimeout(r, Math.max(0, 1300 - (Date.now() - startedTap))))
    onClose()
  }

  if (mode === 'on') {
    const back = toStop ? new Date(startMs + toStop * 3600000).toISOString() : null
    return (
      <Sheet onClose={onClose}>
        <div className="ton-head">
          <h2>{pv.pivot.name}</h2>
          <p className="sub">{pv.fields.map((x) => x.name).join(', ') || 'No fields linked'}{pv.acres ? ` · ${pv.acres.toFixed(0)} ac` : ''}</p>
        </div>

        <PivotDial direction={direction} startDeg={startDeg === '' ? null : Number(startDeg)} stopDeg={stop === 'position' && stopDeg !== '' ? Number(stopDeg) : null}
          stop={stop} starting={starting} disabled={saving} onStart={save} onFlip={() => setDirection(direction === 'forward' ? 'reverse' : 'forward')} />

        <div className="ton-dir" role="group" aria-label="Direction">
          <button type="button" className={direction === 'reverse' ? 'on' : ''} onClick={() => setDirection('reverse')}><span aria-hidden>↺</span> Reverse</button>
          <button type="button" className={direction === 'forward' ? 'on' : ''} onClick={() => setDirection('forward')}>Forward <span aria-hidden>↻</span></button>
        </div>

        <div className="ton-pct">
          <button type="button" aria-label="Lower percent timer" onClick={() => setPct(Math.max(5, pct - 5))}>−</button>
          <div><b>{pct}<small>%</small></b><span>Percent timer</span></div>
          <button type="button" aria-label="Raise percent timer" onClick={() => setPct(Math.min(100, pct + 5))}>+</button>
        </div>

        <div className="ton-sum">
          <div><b>{stop === 'lap' ? 'One lap' : stop === 'keep' ? 'Keep going' : stopDeg !== '' ? `Stop at ${stopDeg}°` : 'Stop at a spot'}</b><span>{pass ? `about ${fmtHours(stop === 'lap' || !toStop ? pass : toStop)}` : 'lap time not known yet'}</span></div>
          <div><b>{perPass !== null ? `${perPass.toFixed(2)} in` : '–'}</b><span>per lap</span></div>
          <div><b>{back && stop !== 'keep' ? fmtClockDay(back) : '–'}</b><span>{stop === 'keep' ? 'no stop set' : 'back around'}</span></div>
        </div>
        <p className="note ton-note">Starting {when === 'now' ? 'now' : fmtWhen(new Date(at).toISOString())} · end gun on{pv.lapHours100 && !pv.pivot.profile.hoursPerRev100 ? ' · lap time learned from past laps' : ''}{!f ? ' · no flow rate yet, so inches are unknown' : ''}</p>

        {!more ? <button type="button" className="ton-more" onClick={() => setMore(true)}>Started earlier, other stop point, or a note</button> : (
          <div className="card form">
            <div className="row"><label>When</label><Seg value={when} options={[['now', 'Now'], ['earlier', 'Earlier']]} onChange={setWhen} /></div>
            {when === 'earlier' && <div className="row"><label>Started at</label><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></div>}
            <div className="row"><label>Stop</label><Seg value={stop} options={[['lap', 'One lap'], ['position', 'At a spot'], ['keep', 'Keep going']]} onChange={setStop} /></div>
            {stop === 'position' && <>
              <div className="row"><label>Starting at (°)</label><input type="number" inputMode="numeric" min={0} max={359} value={startDeg} onChange={(e) => setStartDeg(e.target.value)} style={{ width: 80 }} /></div>
              <div className="row"><label>Stop at (°)</label><input type="number" inputMode="numeric" min={0} max={359} value={stopDeg} onChange={(e) => setStopDeg(e.target.value)} style={{ width: 80 }} /></div>
            </>}
            <div className="row"><label>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></div>
          </div>
        )}
      </Sheet>
    )
  }

  const title = mode === 'off' ? `Turn off · ${pv.pivot.name}` : `Log a past run · ${pv.pivot.name}`
  return (
    <Sheet onClose={onClose}>
      <h2>{title}</h2>
      <p className="sub">{pv.fields.map((x) => x.name).join(', ') || 'No fields linked'}{pv.acres ? ` · ${pv.acres.toFixed(0)} ac` : ''}</p>

      <div className="card form">
        {mode === 'run' && <div className="row"><label>Started</label><input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></div>}
        {mode !== 'run' && <div className="row"><label>When</label><Seg value={when} options={[['now', 'Now'], ['earlier', 'Earlier']]} onChange={setWhen} /></div>}
        {(when === 'earlier' || mode === 'run') && <div className="row"><label>{mode === 'run' ? 'Stopped' : 'Stopped at'}</label><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></div>}
        {mode !== 'off' && <>
          <div className="row"><label>Direction</label><Seg value={direction} options={[['forward', 'Forward'], ['reverse', 'Reverse']]} onChange={setDirection} /></div>
          <div className="row"><label>Percent timer</label><input type="number" inputMode="numeric" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} style={{ width: 80 }} /></div>
        </>}
        <div className="row"><label>Made it around?</label><Seg value={around === null ? '' : around ? 'y' : 'n'} options={[['y', 'Made it around'], ['n', 'Stopped part way']]} onChange={(v) => setAround(v === 'y')} /></div>
        <div className="row"><label>Note</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></div>
      </div>

      {mode === 'off' && running && <div className="calc">
        On since <b>{fmtWhen(running.start!)}</b>, <b>{fmtHours(Math.max(0, offHours!))}</b>
        {f && pv.acres ? <> · about <b>{inchesFrom(f.gpm, Math.max(0, offHours!), pv.acres).toFixed(2)} in</b></> : null}
      </div>}
      {mode === 'off' && !running && <div className="calc warn">No ON logged for this pivot. The OFF will be saved and listed as a gap to fill.</div>}

      <button className={`cta ${mode === 'off' ? 'off' : ''}`} disabled={saving} onClick={save}>
        {mode === 'off' ? (when === 'now' ? 'Turn off now' : 'Save stop') : 'Save run'}
      </button>
      <button className="cta sec2" onClick={onClose}>Cancel</button>
    </Sheet>
  )
}

const fmtClockDay = (iso: string) => {
  const d = new Date(iso)
  const day = d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' })
  return `${day} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

/** The pivot seen from above: arm, towers, end gun and the path it will water. The hub is the start button. */
function PivotDial({ direction, startDeg, stopDeg, stop, starting, disabled, onStart, onFlip }: {
  direction: 'forward' | 'reverse'; startDeg: number | null; stopDeg: number | null; stop: PlannedStop
  starting: boolean; disabled: boolean; onStart: () => void; onFlip: () => void
}) {
  const C = 130, R = 112
  const a0 = startDeg ?? 0
  const sign = direction === 'forward' ? 1 : -1
  // Sweep to show: whole circle for one lap or keep going, the arc to the stop spot otherwise.
  const sweep = stop === 'position' && stopDeg !== null ? (((stopDeg - a0) * sign) % 360 + 360) % 360 || 360 : 360
  const pt = (deg: number, r: number) => [C + r * Math.sin((deg * Math.PI) / 180), C - r * Math.cos((deg * Math.PI) / 180)]
  const [x1, y1] = pt(a0, R - 8), [x2, y2] = pt(a0 + sign * Math.min(sweep, 359.9), R - 8)
  const arc = `M${x1},${y1} A${R - 8},${R - 8} 0 ${sweep > 180 ? 1 : 0} ${sign > 0 ? 1 : 0} ${x2},${y2}`
  const [ax, ay] = pt(a0 + sign * 26, R + 10)
  const towers = [0.3, 0.52, 0.74, 0.94]
  return (
    <div className={`ton-dial ${starting ? 'go' : ''} ${direction}`}>
      <svg viewBox="0 0 260 260" aria-hidden>
        <defs>
          <radialGradient id="tonField" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="var(--leaf)" stopOpacity=".10" />
            <stop offset="1" stopColor="var(--leaf)" stopOpacity=".30" />
          </radialGradient>
        </defs>
        <circle cx={C} cy={C} r={R} fill="url(#tonField)" stroke="var(--sep)" />
        {[0.3, 0.52, 0.74].map((k) => <circle key={k} cx={C} cy={C} r={R * k} fill="none" stroke="var(--sep)" strokeDasharray="2 5" />)}
        <path d={arc} fill="none" stroke="var(--water)" strokeWidth="5" strokeLinecap="round" strokeDasharray="1 9" opacity=".75" />
        {stop === 'position' && stopDeg !== null && (() => { const [sx, sy] = pt(stopDeg, R); return <line x1={C} y1={C} x2={sx} y2={sy} stroke="var(--coral)" strokeWidth="2" strokeDasharray="4 4" /> })()}
        <g className="ton-arm" style={{ transformOrigin: `${C}px ${C}px`, transform: `rotate(${a0}deg)` }}>
          <g className="ton-arm-spin" style={{ transformOrigin: `${C}px ${C}px` }}>
            <rect x={C - 2.5} y={C - R + 2} width="5" height={R - 2} rx="2.5" fill="var(--fg)" opacity=".85" />
            {towers.map((k) => <circle key={k} cx={C} cy={C - R * k} r="5" fill="var(--card)" stroke="var(--fg)" strokeWidth="2" />)}
            <path className="ton-gun" d={`M${C},${C - R + 2} l-14,-14 a20,20 0 0 1 28,0 z`} fill="var(--water)" opacity=".55" />
            <g className="ton-spray">{[0.38, 0.6, 0.82].map((k) => <circle key={k} cx={C + 9} cy={C - R * k} r="2.4" fill="var(--water)" />)}</g>
          </g>
        </g>
        <g className="ton-flip" onClick={onFlip} style={{ cursor: 'pointer', pointerEvents: 'all' }}>
          <circle cx={ax} cy={ay} r="15" fill="var(--card)" stroke="var(--sep)" />
          <text x={ax} y={ay + 6} textAnchor="middle" fontSize="18" fill="var(--water)">{direction === 'forward' ? '↻' : '↺'}</text>
        </g>
      </svg>
      <button type="button" className="ton-hub" disabled={disabled} onClick={onStart} aria-label="Start the pivot now">
        <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden><path d="M12 3v8" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /><path d="M7.05 6.05a7 7 0 1 0 9.9 0" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
        <span>{starting ? 'Running' : 'Start'}</span>
      </button>
    </div>
  )
}
