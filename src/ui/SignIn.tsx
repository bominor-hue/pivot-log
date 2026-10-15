import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db, setSetting, type Person } from '../db'
import { currentSession } from '../sync'
import { Logo } from './brand'

// Who's logging: each person picks their name and types their 4-digit PIN. Works with no signal
// because it checks against the people saved on the phone. Someone with no PIN (an office person or
// a viewer who signs in by email) only shows on a device signed in with their own email.

export async function hashPin(name: string, pin: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pivot-log:${name.trim().toLowerCase()}:${pin}`))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const COLORS = ['#0E6BA8', '#7a5ab8', '#3f9a5a', '#c27a2c', '#b8475a', '#2f8f8f', '#5b6fb8', '#8a6a3a']
export const personColor = (name: string) => COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length]
export const ROLE_LABEL: Record<Person['role'], string> = { crew: 'Crew', manager: 'Manager', office: 'Office', viewer: 'Viewer' }

export function Avatar({ name }: { name: string }) {
  return <span className="ava" style={{ background: personColor(name) }}>{name.trim()[0]?.toUpperCase() ?? '?'}</span>
}

export function SignIn({ onIn }: { onIn: (p: Person) => void }) {
  const people = useLiveQuery(() => db.people.orderBy('name').toArray(), [], [])
  const [email, setEmail] = useState<string | null>(null)
  const [who, setWho] = useState<Person | null>(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { currentSession().then((s) => setEmail(s?.user.email?.toLowerCase() ?? null)) }, [])
  const shown = people.filter((p) => p.pinHash || (email && p.email?.toLowerCase() === email))
  async function go(p: Person, value: string) {
    if (p.pinHash && (await hashPin(p.name, value)) !== p.pinHash) { setErr('That PIN is not right. Ask the office if you forgot it.'); setPin(''); return }
    await setSetting('me', p.name); await setSetting('meId', p.id)
    onIn(p)
  }
  return (
    <div className="page">
      <div className="wel" style={{ paddingTop: 24 }}><div className="mark"><Logo animate size={84} /></div><h1>Who's logging?</h1><p>Pick your name, then enter your PIN.</p></div>
      {!who ? <div className="card">{shown.map((p, i) => (
        <button key={p.id} className="row stag" style={{ '--i': Math.min(i, 12) } as any} onClick={() => (p.pinHash ? setWho(p) : go(p, ''))}>
          <Avatar name={p.name} /><span className="t"><b>{p.name}</b><span>{ROLE_LABEL[p.role] ?? p.role}</span></span>
        </button>))}
        {!shown.length && <div className="row"><span className="t"><b>No one set up on this phone yet</b><span>Ask the office to add you with a PIN.</span></span></div>}
      </div>
        : <div className="card form" style={{ padding: 14, textAlign: 'center' }}>
          <Avatar name={who.name} /><b style={{ display: 'block', fontSize: 20, marginTop: 6 }}>{who.name}</b>
          <input id="pin" autoFocus type="password" inputMode="numeric" maxLength={6} value={pin} placeholder="PIN" aria-label="PIN" style={{ display: 'block', width: '100%', maxWidth: '100%', textAlign: 'center', fontSize: 28, letterSpacing: 8, marginTop: 12 }}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setPin(v); setErr(''); if (v.length === 4) go(who, v) }} />
          {err && <p className="note warn">{err}</p>}
          <button className="cta sec2" onClick={() => { setWho(null); setPin(''); setErr('') }}>Not me</button>
        </div>}
    </div>
  )
}
