import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getSetting, uid, type Pivot } from '../db'
import { rank, setProfile } from '../domain/pivot'
import { CHART_FIELDS, type ChartReading } from '../chartRead'
import { currentSession } from '../sync'
import { useNav } from './common'

// Office: photograph a pivot's dealer sprinkler chart (or pick the PDF) and fill the pivot info
// fields from it. The chart is read on the server (netlify/functions/read-chart.mts); nothing saves
// until the office has checked each value here.

const SOURCE = 'dealer chart'

/** Shrink a photo so several pages fit in one upload and read quickly. */
async function shrink(file: File): Promise<{ type: string; data: string }> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  const url = c.toDataURL('image/jpeg', 0.85)
  return { type: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) }
}
const asBase64 = (file: File) => new Promise<string>((ok, bad) => {
  const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(file)
})

interface Row { key: string; label: string; value: string; seenAs: string; use: boolean; current: string | null; kept: boolean }

export function ChartRead({ pivot }: { pivot: Pivot }) {
  const { toast, me } = useNav()
  const office = useLiveQuery(() => getSetting('officeLogin', false), [], false)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [notes, setNotes] = useState('')
  if (!office) return null

  async function read(list: FileList | null) {
    if (!list?.length) return
    const files = [...list]
    const pdf = files.find((f) => f.type === 'application/pdf')
    if (pdf && pdf.size > 4_000_000) return toast('That PDF is too big. Take photos of the pages instead.')
    const session = await currentSession()
    if (!session) return toast('Sign in as the office first (Settings, Farm account).')
    setBusy(true)
    try {
      const body = { files: pdf ? [{ type: pdf.type, data: await asBase64(pdf) }] : await Promise.all(files.slice(0, 6).map(shrink)) }
      const res = await fetch('/.netlify/functions/read-chart', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) })
      const out = await res.json().catch(() => ({ error: `Chart reader error (${res.status}).` }))
      if (!res.ok || out.error) return toast(out.error ?? 'Could not read that chart.')
      const r = out as ChartReading
      if (!r.values.length) return toast('No pivot details found on that chart. Try a sharper photo.')
      setNotes(r.notes)
      setRows(r.values.map((v) => {
        const f = CHART_FIELDS.find((x) => x.key === v.key)!
        const cur = pivot.profile[v.key]
        const kept = !!cur && rank(cur.source) > rank(SOURCE) // a measured value stays
        return { key: v.key, label: f.label, value: String(v.value), seenAs: v.seenAs, use: !kept && String(cur?.value ?? '') !== String(v.value), current: cur ? `${cur.value} (${cur.source})` : null, kept }
      }))
    } catch {
      toast('Could not reach the chart reader. Check the signal and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    const p = await db.pivots.get(pivot.id)
    if (!p || !rows) return
    const at = new Date().toISOString()
    let n = 0
    for (const r of rows.filter((x) => x.use && x.value.trim())) {
      const f = CHART_FIELDS.find((x) => x.key === r.key)!
      const v = f.numeric ? parseFloat(r.value.replace(/,/g, '')) : r.value.trim()
      if (f.numeric && !(Number(v) > 0)) continue
      if (setProfile(p, r.key, v, SOURCE, at)) n++
    }
    await db.pivots.put(p)
    await db.imports.add({ id: uid(), kind: 'sprinkler chart', fileName: `${p.name} chart`, at, who: me, summary: `${n} values saved from the dealer chart` })
    setRows(null)
    toast(`Saved ${n} value${n === 1 ? '' : 's'} to ${p.name}`)
  }

  const set = (i: number, ch: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...ch } : r)))

  if (rows) return <>
    <div className="sec">From the sprinkler chart</div>
    {notes && <p className="note warn">{notes}</p>}
    <div className="card form">
      {rows.map((r, i) => (
        <div className="row" key={r.key}>
          <label htmlFor={'cr-' + r.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={r.use} disabled={r.kept} onChange={(e) => set(i, { use: e.target.checked })} aria-label={'Save ' + r.label} />
            {r.label}
          </label>
          <input id={'cr-' + r.key} value={r.value} disabled={r.kept} onChange={(e) => set(i, { value: e.target.value, use: true })} />
          <small className="note">{r.kept ? `Keeping ${r.current}` : r.current ? `Now: ${r.current}` : 'Not filled yet'}{r.seenAs ? ` · chart says "${r.seenAs}"` : ''}</small>
        </div>
      ))}
    </div>
    <button className="cta" onClick={save} disabled={!rows.some((r) => r.use)}>Save checked values</button>
    <button className="cta sec2" onClick={() => setRows(null)}>Cancel</button>
    <p className="note">Check each value against the chart before saving. Ticked values are saved as "dealer chart"; a measured value is never replaced.</p>
  </>

  return <>
    <label className={'cta sec2' + (busy ? ' busy' : '')} style={{ display: 'block', textAlign: 'center' }} aria-disabled={busy}>
      {busy ? 'Reading the chart…' : 'Read the sprinkler chart'}
      <input type="file" accept="image/*,application/pdf" multiple hidden disabled={busy} onChange={(e) => { read(e.target.files); e.target.value = '' }} />
    </label>
    <p className="note">Take a photo of each page of the dealer's sprinkler chart (or pick its PDF). You'll check every value before it saves.</p>
  </>
}
