import { db, DEFAULT_CLIENT, getSetting, setSetting, uid, type Client, type Farm, type Field, type Person, type Pivot } from '../db'

// Clients: the app shows one client's farms, fields and pivots at a time. The phone remembers which
// client is picked (setting 'clientId'); each person can be limited to some clients (Person.clientIds).

export const DEFAULT_NAME = 'Main client'
export const clientOf = (f: Farm) => f.clientId || DEFAULT_CLIENT

/** Every client, by name. Farms from before clients existed show up under the default client, even
 * before anyone has named it. */
export async function listClients(): Promise<Client[]> {
  const [clients, farms] = await Promise.all([db.clients.toArray(), db.farms.toArray()])
  if (!clients.some((c) => c.id === DEFAULT_CLIENT) && farms.some((f) => clientOf(f) === DEFAULT_CLIENT)) clients.push({ id: DEFAULT_CLIENT, name: DEFAULT_NAME })
  return clients.sort((a, b) => a.name.localeCompare(b.name))
}

/** The clients this person may pick. Office and owners see all; no list means all. */
export function allowedClients(clients: Client[], person: Person | null | undefined): Client[] {
  if (!person || person.owner || person.role === 'office' || !person.clientIds?.length) return clients
  return clients.filter((c) => person.clientIds!.includes(c.id))
}

/** The client to show: the one picked on this phone if it still exists, else the only or first one. */
export function pickClient(clients: Client[], picked: string | null): string {
  return clients.find((c) => c.id === picked)?.id ?? clients[0]?.id ?? DEFAULT_CLIENT
}

export async function currentClientId(): Promise<string> {
  return pickClient(await listClients(), await getSetting<string | null>('clientId', null))
}

/** The picked client's farms, pivots and fields. Imports match names only within these. */
export async function clientScope(clientId?: string): Promise<{ clientId: string; farms: Farm[]; pivots: Pivot[]; fields: Field[] }> {
  const id = clientId ?? (await currentClientId())
  const farms = (await db.farms.toArray()).filter((f) => clientOf(f) === id)
  const ids = new Set(farms.map((f) => f.id))
  const [pivots, fields] = await Promise.all([db.pivots.toArray(), db.fields.toArray()])
  return { clientId: id, farms, pivots: pivots.filter((p) => ids.has(p.farmId)), fields: fields.filter((f) => ids.has(f.farmId)) }
}

export async function addClient(name: string): Promise<Client> {
  const c = { id: uid(), name: name.trim() }
  await db.clients.put(c)
  await setSetting('clientId', c.id)
  return c
}

export async function renameClient(id: string, name: string) {
  await db.clients.put({ id, name: name.trim() })
}

/** Farms, pivots and fields under each client, for the picker and Settings. */
export async function clientCounts(): Promise<Record<string, { farms: number; pivots: number; fields: number }>> {
  const [farms, pivots, fields] = await Promise.all([db.farms.toArray(), db.pivots.toArray(), db.fields.toArray()])
  const of = new Map(farms.map((f) => [f.id, clientOf(f)]))
  const out: Record<string, { farms: number; pivots: number; fields: number }> = {}
  const get = (id: string | undefined) => (id ? (out[id] ??= { farms: 0, pivots: 0, fields: 0 }) : null)
  for (const f of farms) get(clientOf(f))!.farms++
  for (const p of pivots) { const c = get(of.get(p.farmId)); if (c) c.pivots++ }
  for (const f of fields) { const c = get(of.get(f.farmId)); if (c) c.fields++ }
  return out
}
