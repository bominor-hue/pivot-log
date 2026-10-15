import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, getSetting, setSetting, uid, type Person } from '../db'
import { manageLogin, removePerson, syncNow } from '../sync'
import { Sheet, useNav } from './common'
import { Avatar, ROLE_LABEL, hashPin } from './SignIn'

// Settings, Users: invite people, set their role, reset a PIN, remove access.
//   Crew    turn pivots on and off and log runs; sign in with a 4-digit PIN on a farm phone.
//   Office  everything, plus pivot info, connections and people; signs in by email.
//   Viewer  read-only: reports and the log; signs in by email. For agents, NRCS, landlords.
// Removing someone takes them off every phone; their past entries stay in the records with their name.

type Role = 'crew' | 'office' | 'viewer'
const ROLES: [Role, string][] = [
  ['crew', 'Turn pivots on and off, log runs, see Today and Map. Signs in with a PIN.'],
  ['office', 'Everything, plus pivot info, connections and people. Signs in by email.'],
  ['viewer', 'Read-only: reports and the log. For agents, NRCS, landlords. Signs in by email.'],
]
const usesEmail = (r: Person['role']) => r !== 'crew'
const line = (p: Person) => [
  ROLE_LABEL[p.role] ?? p.role,
  usesEmail(p.role) ? (p.email ? `email sign-in, ${p.email}` : 'no email yet') : null,
  p.pinHash ? 'PIN' : p.role === 'crew' ? 'no PIN yet' : null,
  p.invitedAt ? `invited ${new Date(p.invitedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : null,
].filter(Boolean).join(' · ')

export function Users({ canAdmin }: { canAdmin: boolean }) {
  const people = useLiveQuery(() => db.people.orderBy('name').toArray(), [], [])
  const meId = useLiveQuery(() => getSetting<string | null>('meId', null), [], null)
  const [sheet, setSheet] = useState<'invite' | Person | null>(null)
  const sorted = [...people].sort((a, b) => Number(!!b.owner) - Number(!!a.owner) || (a.role === 'crew' ? 1 : 0) - (b.role === 'crew' ? 1 : 0) || a.name.localeCompare(b.name))
  return <>
    {sorted.length > 0 ? <div className="card">{sorted.map((p, i) => (
      <button key={p.id} className="row stag" style={{ '--i': i } as any} disabled={!canAdmin && p.id !== meId} onClick={() => setSheet(p)}>
        <Avatar name={p.name} />
        <span className="t"><b>{p.name}{p.id === meId && <span className="you"> (you)</span>}</b><span>{line(p)}</span></span>
        <span className={'role' + (p.role === 'office' || p.role === 'manager' || p.owner ? ' o' : '')}>{p.owner ? 'Owner' : p.invitedAt && usesEmail(p.role) ? 'Invited' : ROLE_LABEL[p.role]}</span>
      </button>))}</div>
      : <p className="note">No one yet. Add yourself first; the first person added is the owner and runs the office.</p>}
    {canAdmin && <button className="cta" onClick={() => setSheet('invite')}>+ {people.length ? 'Invite someone' : 'Add yourself'}</button>}
    <p className="note">Crew sign in with a 4-digit PIN on a farm phone. Office and viewers get an email sign-in. Removing someone signs them out; their past log entries stay in the records.</p>
    {sheet === 'invite' && <Invite people={people} onClose={() => setSheet(null)} />}
    {sheet && sheet !== 'invite' && <PersonSheet p={sheet} self={sheet.id === meId} canAdmin={canAdmin} onClose={() => setSheet(null)} />}
  </>
}

function Invite({ people, onClose }: { people: Person[]; onClose: () => void }) {
    const { me, toast } = useNav()
    const first = !people.length
    const [name, setName] = useState(first ? me : '')
    const [role, setRole] = useState<Role>(first ? 'office' : 'crew')
    const [pin, setPin] = useState('')
    const [email, setEmail] = useState('')
    const [busy, setBusy] = useState(false)
    const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
    // The first person needs a PIN so nobody gets locked out of this phone.
    const ok = name.trim() && (role === 'crew' || first ? /^\d{4}$/.test(pin) : emailOk && (!pin || /^\d{4}$/.test(pin)))
    async function save() {
      setBusy(true)
      const id = people.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())?.id ?? uid()
      const e = email.trim().toLowerCase() || null
      const p: Person = { id, name: name.trim(), role: first ? 'office' : role, pinHash: pin ? await hashPin(name, pin) : null, email: usesEmail(role) ? e : null, owner: first || undefined, invitedAt: !first && usesEmail(role) && e ? new Date().toISOString() : null }
      await db.people.put(p)
      if (first) { await setSetting('me', p.name); await setSetting('meId', id) }
      let err: string | null = null
      if (!first && p.email) { await syncNow().catch(() => {}); err = await manageLogin('invite', p.email, p.role) }
      setBusy(false); onClose()
      toast(err ?? (p.role === 'crew' ? `${p.name} added to crew` : first ? `${p.name} added` : `Invite sent to ${p.email}`))
    }
    return <Sheet onClose={onClose}>
      <h2>{first ? 'Add yourself' : 'Invite someone'}</h2>
      <p className="sub">{first ? "You'll be the owner. Pick a PIN for this phone." : 'Everyone sees every farm for now.'}</p>
      <label className="fld"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" autoComplete="off" /></label>
      {!first && <div className="roles" role="radiogroup" aria-label="Role">{ROLES.map(([r, d]) => (
        <button key={r} type="button" role="radio" className="ropt" aria-checked={role === r} onClick={() => setRole(r)}><i /><div><b>{ROLE_LABEL[r]}</b><span>{d}</span></div></button>))}</div>}
      {usesEmail(role) && !first && <label className="fld"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" /></label>}
      <label className="fld"><span>{role === 'crew' || first ? '4-digit PIN' : '4-digit PIN (optional, to use a shared farm phone)'}</span><input inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" autoComplete="off" /></label>
      <button className="cta" disabled={!ok || busy} onClick={save}>{busy ? 'Saving…' : first ? 'Add me' : role === 'crew' ? 'Add to crew' : 'Send email invite'}</button>
      <button className="cta sec2" onClick={onClose}>Cancel</button>
    </Sheet>
}

function PersonSheet({ p, self, canAdmin, onClose }: { p: Person; self: boolean; canAdmin: boolean; onClose: () => void }) {
    const { toast } = useNav()
    const [pin, setPin] = useState('')
    const [sure, setSure] = useState(false)
    const [busy, setBusy] = useState(false)
    const edit = canAdmin && !p.owner
    const setRole = async (role: Role) => {
      if (role === p.role) return
      if (usesEmail(role) && !p.email) return toast(`Add ${p.name} again with an email to make them ${ROLE_LABEL[role]}.`)
      await db.people.put({ ...p, role, email: usesEmail(role) ? p.email : null })
      let err: string | null = null
      if (p.email) { await syncNow().catch(() => {}); err = await manageLogin(role === 'crew' ? 'remove' : 'role', p.email, role) }
      onClose(); toast(err ?? `${p.name} is now ${ROLE_LABEL[role]}`)
    }
    const remove = async () => {
      setBusy(true)
      const err = p.email ? await manageLogin('remove', p.email) : null
      await removePerson(p.id)
      setBusy(false); onClose(); toast(err ? `${p.name} removed from the app. ${err}` : `${p.name} removed`)
    }
    if (sure) return <Sheet onClose={onClose}>
      <h2>Remove {p.name}?</h2>
      <p className="sub">{p.name} is signed out on every phone{p.email ? ' and their email sign-in is deleted' : ''}. Their past log entries stay in the records with their name on them.</p>
      <button className="cta off" disabled={busy} onClick={remove}>{busy ? 'Removing…' : 'Remove access'}</button>
      <button className="cta sec2" onClick={() => setSure(false)}>Keep</button>
    </Sheet>
    return <Sheet onClose={onClose}>
      <h2>{p.name}</h2>
      <p className="sub">{p.owner ? "The owner. Can't be removed here." : line(p)}</p>
      {edit && <div className="seg" role="group" aria-label="Role" style={{ margin: '4px 0 12px' }}>{(['crew', 'office', 'viewer'] as Role[]).map((r) => (
        <button key={r} type="button" className={p.role === r || (r === 'office' && p.role === 'manager') ? 'on' : ''} onClick={() => setRole(r)}>{ROLE_LABEL[r]}</button>))}</div>}
      {(edit || self) && <>
        <label className="fld"><span>New 4-digit PIN</span><input inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" autoComplete="off" /></label>
        <button className="cta sec2" disabled={!/^\d{4}$/.test(pin)} onClick={async () => { await db.people.put({ ...p, pinHash: await hashPin(p.name, pin) }); onClose(); toast(`New PIN saved for ${p.name}`) }}>Save new PIN</button>
      </>}
      {edit && p.email && <button className="cta sec2" disabled={busy} onClick={async () => { setBusy(true); const err = await manageLogin('invite', p.email!, p.role); if (!err) await db.people.put({ ...p, invitedAt: new Date().toISOString() }); setBusy(false); toast(err ?? 'Invite sent again') }}>Resend invite</button>}
      {edit && !self && <button className="cta off" onClick={() => setSure(true)}>Remove access</button>}
      <button className="cta sec2" onClick={onClose}>Done</button>
    </Sheet>
}
