import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, setSetting, type Client, type Person } from '../db'
import { addClient, clientCounts, listClients, renameClient } from '../domain/client'
import { Chevron, Sheet, useNav } from './common'
import { Logo } from './brand'

// Picking a client: the whole app then shows only that client's farms, fields and pivots.

const countLine = (n?: { farms: number; pivots: number; fields: number }) =>
  n ? `${n.pivots} pivot${n.pivots === 1 ? '' : 's'} · ${n.fields} field${n.fields === 1 ? '' : 's'}` : 'Nothing imported yet'

function ClientList({ clients, current, onPick }: { clients: Client[]; current?: string; onPick: (c: Client) => void }) {
  const counts = useLiveQuery(clientCounts, [], {} as Awaited<ReturnType<typeof clientCounts>>)
  return <div className="card">{clients.map((c, i) => (
    <button key={c.id} className="row stag" style={{ '--i': Math.min(i, 12) } as any} aria-current={c.id === current || undefined} onClick={() => onPick(c)}>
      <span className="lg" style={{ background: 'var(--leaf)' }}>{c.name.trim()[0]?.toUpperCase() ?? '?'}</span>
      <span className="t"><b>{c.name}</b><span>{countLine(counts[c.id])}</span></span>
      {c.id === current ? <span className="pill p-ok">Showing</span> : <Chevron />}
    </button>))}
  </div>
}

/** Full screen, when someone who can see more than one client hasn't picked one on this phone yet. */
export function ClientPicker({ clients }: { clients: Client[] }) {
  return <div className="page">
    <div className="wel" style={{ paddingTop: 24 }}><div className="mark"><Logo animate size={84} /></div><h1>Pick a client</h1><p>You'll see only that client's farms, fields and pivots. Switch any time from the client name at the top.</p></div>
    <ClientList clients={clients} onPick={(c) => setSetting('clientId', c.id)} />
  </div>
}

/** The sheet behind the client name at the top of each main screen. */
export function ClientSheet({ onClose }: { onClose: () => void }) {
  const { clients = [], state, canAdmin, push, toast } = useNav()
  return <Sheet onClose={onClose}>
    <h2>Clients</h2>
    <p className="sub">Pick whose farms to show.</p>
    <ClientList clients={clients} current={state.clientId} onPick={async (c) => { await setSetting('clientId', c.id); onClose(); toast(`Showing ${c.name}`) }} />
    {canAdmin && <button className="cta sec2" onClick={() => { onClose(); push({ kind: 'settings', tab: 'clients' }) }}>Add or rename clients</button>}
  </Sheet>
}

/** Settings, Clients: add a client, rename one, switch to one. */
export function ClientsTab({ canAdmin }: { canAdmin: boolean }) {
  const { clients = [], state, toast } = useNav()
  const [name, setName] = useState('')
  const [edit, setEdit] = useState<Client | null>(null)
  const add = async () => {
    const n = name.trim()
    if (clients.some((c) => c.name.toLowerCase() === n.toLowerCase())) return toast(`There's already a client called ${n}.`)
    const c = await addClient(n)
    setName(''); toast(`Added ${c.name}. Import its fields and pivots next.`)
  }
  return <>
    <ClientList clients={clients} current={state.clientId} onPick={(c) => (canAdmin ? setEdit(c) : setSetting('clientId', c.id))} />
    {!clients.length && <p className="note">No clients yet. Your first import goes under a client called "Main client"; rename it here.</p>}
    {canAdmin && <>
      <div className="sec">Add a client</div>
      <div className="card" style={{ padding: 14 }}>
        <label className="fld"><span>Client name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Farm or business name" autoComplete="off" /></label>
        <button className="cta" disabled={name.trim().length < 2} onClick={add}>Add client</button>
      </div>
      <p className="note">A new client starts empty. Pick it, then use Import files to bring in its fields, boundaries and pivot sheet. Imports always go to the client you're looking at.</p>
    </>}
    {edit && <RenameSheet c={edit} showing={edit.id === state.clientId} onClose={() => setEdit(null)} />}
  </>
}

function RenameSheet({ c, showing, onClose }: { c: Client; showing: boolean; onClose: () => void }) {
  const { toast } = useNav()
  const [name, setName] = useState(c.name)
  return <Sheet onClose={onClose}>
    <h2>{c.name}</h2>
    <label className="fld"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
    <button className="cta" disabled={name.trim().length < 2 || name.trim() === c.name} onClick={async () => { await renameClient(c.id, name); onClose(); toast('Name saved') }}>Save name</button>
    {!showing && <button className="cta sec2" onClick={async () => { await setSetting('clientId', c.id); onClose(); toast(`Showing ${c.name}`) }}>Show this client</button>}
    <button className="cta sec2" onClick={onClose}>Done</button>
  </Sheet>
}

/** On a person: which clients they can pick. None ticked means all. Office people always see all. */
export function ClientAccess({ p }: { p: Person }) {
  const all = useLiveQuery(listClients, [], [])
  if (all.length < 2 || p.role === 'office' || p.owner) return null
  const ids = p.clientIds ?? []
  const toggle = async (id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    await db.people.put({ ...p, clientIds: next.length ? next : null })
  }
  return <>
    <div className="sec" style={{ marginTop: 4 }}>Clients {p.name.split(' ')[0]} can see</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
      {all.map((c) => <label key={c.id} className="chk"><input type="checkbox" checked={ids.includes(c.id)} onChange={() => toggle(c.id)} />{c.name}</label>)}
    </div>
    <p className="note" style={{ marginTop: 0 }}>{ids.length ? `Only the ticked client${ids.length > 1 ? 's' : ''}.` : 'None ticked means every client.'}</p>
  </>
}
