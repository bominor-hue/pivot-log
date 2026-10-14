import { removePerson } from '../sync'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, setSetting, uid, type Person } from '../db'

// Crew sign-in while texting is on hold: the office gives each person a 4-digit PIN (PRD v3, open
// decision 2). Works with no signal because it checks against people saved on the phone.
// Office sign-in by email link comes with the hosted database.

export async function hashPin(name: string, pin: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pivot-log:${name.trim().toLowerCase()}:${pin}`))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function SignIn({ onIn }: { onIn: (p: Person) => void }) {
  const people = useLiveQuery(() => db.people.orderBy('name').toArray(), [], [])
  const [who, setWho] = useState<Person | null>(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  async function go(p: Person, value: string) {
    if (p.pinHash && (await hashPin(p.name, value)) !== p.pinHash) { setErr('That PIN is not right. Ask the office if you forgot it.'); setPin(''); return }
    await setSetting('me', p.name); await setSetting('meId', p.id)
    onIn(p)
  }
  return (
    <div className="page">
      <h1 className="lt">Who's logging?</h1>
      <p className="sub">Pick your name, then enter your PIN.</p>
      {!who ? <div className="card">{people.map((p) => (
        <button key={p.id} className="row" onClick={() => (p.pinHash ? setWho(p) : go(p, ''))}><span className="t"><b>{p.name}</b><span>{p.role}</span></span></button>))}</div>
        : <div className="card form" style={{ padding: 14 }}>
          <b style={{ fontSize: 20 }}>{who.name}</b>
          <input id="pin" autoFocus type="password" inputMode="numeric" maxLength={6} value={pin} placeholder="PIN" style={{ display: 'block', width: '100%', maxWidth: '100%', textAlign: 'center', fontSize: 28, letterSpacing: 8, marginTop: 12 }}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setPin(v); setErr(''); if (v.length === 4) go(who, v) }} />
          {err && <p className="note warn">{err}</p>}
          <button className="cta sec2" onClick={() => { setWho(null); setPin(''); setErr('') }}>Not me</button>
        </div>}
    </div>
  )
}

/** Office: add crew and set PINs. */
export function People() {
  const people = useLiveQuery(() => db.people.orderBy('name').toArray(), [], [])
  const [name, setName] = useState('')
  const [role, setRole] = useState<Person['role']>('crew')
  const [pin, setPin] = useState('')
  const [email, setEmail] = useState('')
  const ok = name.trim() && /^\d{4}$/.test(pin)
  return (
    <>
      <div className="sec">People <small>{people.length}</small></div>
      {people.length > 0 && <div className="card">{people.map((p) => (
        <div key={p.id} className="row"><span className="t"><b>{p.name}</b><span>{p.role}{p.pinHash ? ' · PIN set' : ' · no PIN'}{p.email ? ` · ${p.email}` : ''}</span></span>
          <button className="btn sm" onClick={() => removePerson(p.id)}>Remove</button></div>))}</div>}
      <div className="card form" style={{ marginTop: 10 }}>
        <div className="row"><label htmlFor="pp-name">Name</label><input id="pp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Juan" /></div>
        {people.length > 0 && <div className="row"><label htmlFor="pp-role">Role</label><select id="pp-role" value={role} onChange={(e) => setRole(e.target.value as Person['role'])}><option value="crew">Crew</option><option value="manager">Manager</option><option value="office">Office</option></select></div>}
        {(people.length === 0 || role !== 'crew') && <div className="row"><label htmlFor="pp-email">Email (office sign-in)</label><input id="pp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" /></div>}
        <div className="row"><label htmlFor="pp-pin">4-digit PIN</label><input id="pp-pin" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></div>
      </div>
      <button className="cta" disabled={!ok} onClick={async () => {
        // The first person added runs the office, and stays signed in, so nobody gets locked out.
        const first = people.length === 0
        const id = people.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())?.id ?? uid()
        const r = first ? 'office' : role
        await db.people.put({ id, name: name.trim(), role: r, pinHash: await hashPin(name, pin), email: r !== 'crew' && email.trim() ? email.trim().toLowerCase() : null })
        if (first) { await setSetting('me', name.trim()); await setSetting('meId', id) }
        setName(''); setPin(''); setEmail('')
      }}>Add or update person</button>
      {people.length === 0 && <p className="note">Add yourself first. The first person added runs the office.</p>}
      <p className="note">Once anyone is added, the app asks "Who's logging?" and every entry carries that person's name. Only office and manager roles can import.</p>
    </>
  )
}
