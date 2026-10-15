import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { db, getSetting, setSetting, type Entry } from './db'

// Hosted database (Supabase Postgres, in the farm's own account). Optional: with no keys set the app
// runs fully on the device. With keys set and a login on the phone:
//   - entries queue on the phone and push up when there is signal, and everyone's entries come down;
//   - master lists (clients, farms, pivots, fields, crops, people, probes, weather, rain) come down to every
//     phone, and go up from the office's device after an import.
// Logins: the office signs in with an email link; crew phones share one crew login (email + password)
// that the office types in once. See supabase/migrations/0001_init.sql for who may write what.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null

/** Local table <-> server table. Server rows are { id, data } with data = the local row. */
const MASTER = [
  { table: 'client', local: () => db.clients, id: (r: any) => r.id as string },
  { table: 'farm', local: () => db.farms, id: (r: any) => r.id as string },
  { table: 'pivot', local: () => db.pivots, id: (r: any) => r.id as string },
  { table: 'field', local: () => db.fields, id: (r: any) => r.id as string },
  { table: 'crop_season', local: () => db.cropSeasons, id: (r: any) => r.id as string },
  { table: 'person', local: () => db.people, id: (r: any) => r.id as string },
  { table: 'probe', local: () => db.probes, id: (r: any) => r.id as string },
  { table: 'weather_day', local: () => db.weather, id: (r: any) => r.date as string },
  { table: 'rain_day', local: () => db.rain, id: (r: any) => `${r.pivotId}|${r.date}` },
  { table: 'import_log', local: () => db.imports, id: (r: any) => r.id as string },
] as const

export async function waitingToSend(): Promise<number> {
  return db.entries.where('synced').equals(0).count()
}

// ---- Sign-in -------------------------------------------------------------------------------------

export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null
  return (await supabase.auth.getSession()).data.session
}

/** Office: email a sign-in link. Only emails the office added in Supabase can sign in. */
export async function emailLink(email: string): Promise<string | null> {
  if (!supabase) return 'No hosted database set up'
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } })
  return error ? error.message : null
}

/** Office: the 6-digit code from the same email. An iPhone home-screen app can't receive the link's sign-in, so the code is the reliable way. */
export async function emailCode(email: string, code: string): Promise<string | null> {
  if (!supabase) return 'No hosted database set up'
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
  return error ? error.message : null
}

/** Crew phone: the shared crew login. */
export async function crewLogin(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'No hosted database set up'
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  return error ? error.message : null
}

export async function logout() {
  await supabase?.auth.signOut()
  await setSetting('officeLogin', false)
}

/** After an email-link sign-in: the first one becomes the office; later ones are office if listed. */
async function checkOffice(): Promise<boolean> {
  if (!supabase) return false
  const { data, error } = await supabase.rpc('claim_office')
  if (error) return getSetting('officeLogin', false) // offline or a hiccup: keep what we knew
  await setSetting('officeLogin', data === true)
  return data === true
}

// ---- Entries -------------------------------------------------------------------------------------

export const toRow = (e: Entry) => ({
  id: e.id, pivot_id: e.pivotId, action: e.action, happened_at: e.happenedAt, recorded_at: e.recordedAt, who_name: e.who, how: e.how,
  lat: e.lat ?? null, lon: e.lon ?? null, direction: e.direction ?? null, percent_timer: e.percentTimer ?? null, planned_stop: e.plannedStop ?? null,
  start_deg: e.startDeg ?? null, stop_deg: e.stopDeg ?? null, end_gun: e.endGun ?? null, made_it_around: e.madeItAround ?? null,
  start_at: e.startAt ?? null, stop_at: e.stopAt ?? null, hours: e.hours ?? null, note: e.note ?? null, corrects_id: e.correctsId ?? null,
})
export const fromRow = (r: any): Entry => ({
  id: r.id, pivotId: r.pivot_id, action: r.action, happenedAt: r.happened_at, recordedAt: r.recorded_at, who: r.who_name, how: r.how,
  lat: r.lat, lon: r.lon, direction: r.direction, percentTimer: num(r.percent_timer), plannedStop: r.planned_stop,
  startDeg: num(r.start_deg), stopDeg: num(r.stop_deg), endGun: r.end_gun, madeItAround: r.made_it_around,
  startAt: r.start_at, stopAt: r.stop_at, hours: num(r.hours), note: r.note, correctsId: r.corrects_id, synced: 1,
})
const num = (v: any) => (v === null || v === undefined ? null : Number(v))

/** Push unsent entries. Safe to call any time: entries are keyed by their id, so a retry never duplicates. */
export async function pushEntries(): Promise<{ sent: number; error?: string }> {
  if (!supabase) return { sent: 0, error: 'No hosted database set up yet; entries are kept on this device' }
  if (!navigator.onLine) return { sent: 0, error: 'Offline' }
  if (!(await currentSession())) return { sent: 0, error: 'Sign this device in to the farm account to send' }
  if (await getSetting('demo', false)) return { sent: 0, error: 'Demo data is never sent. Erase the demo first.' }
  const pending = await db.entries.where('synced').equals(0).toArray()
  if (!pending.length) return { sent: 0 }
  // Corrections point at earlier entries, so send in the order they were recorded.
  pending.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
  const { error } = await supabase.from('entry').upsert(pending.map(toRow), { onConflict: 'id', ignoreDuplicates: true })
  if (error) return { sent: 0, error: error.message }
  await db.entries.bulkUpdate(pending.map((e) => ({ key: e.id, changes: { synced: 1 as const } })))
  return { sent: pending.length }
}

/** Fetch everything newer than the last pull, a page at a time. */
async function pullSince(table: string, col: string, cursorKey: string, select = '*'): Promise<any[]> {
  const since = await getSetting<string>(cursorKey, '1970-01-01T00:00:00Z')
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase!.from(table).select(select).gt(col, since).order(col).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  if (out.length) await setSetting(cursorKey, out[out.length - 1][col])
  return out
}

// ---- Master lists ----------------------------------------------------------------------------------

/** Small, stable fingerprint so the office only sends rows that changed. */
export function fingerprint(row: unknown): string {
  const s = JSON.stringify(row)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36) + s.length.toString(36)
}

async function pullMaster(): Promise<number> {
  let n = 0
  for (const m of MASTER) {
    const rows = await pullSince(m.table, 'updated_at', `pull:${m.table}`)
    if (!rows.length) continue
    const sent = await getSetting<Record<string, string>>(`sent:${m.table}`, {})
    for (const r of rows) sent[r.id] = fingerprint(r.data)
    await (m.local() as any).bulkPut(rows.map((r) => r.data))
    await setSetting(`sent:${m.table}`, sent)
    n += rows.length
  }
  return n
}

async function pushMaster(who: string): Promise<number> {
  let n = 0
  for (const m of MASTER) {
    const all = await (m.local() as any).toArray()
    const sent = await getSetting<Record<string, string>>(`sent:${m.table}`, {})
    const changed = all.filter((r: any) => sent[m.id(r)] !== fingerprint(r))
    for (let i = 0; i < changed.length; i += 500) {
      const batch = changed.slice(i, i + 500)
      const { error } = await supabase!.from(m.table).upsert(batch.map((r: any) => ({ id: m.id(r), data: r, updated_by: who })))
      if (error) throw new Error(`${m.table}: ${error.message}`)
      for (const r of batch) sent[m.id(r)] = fingerprint(r)
      await setSetting(`sent:${m.table}`, sent)
      n += batch.length
    }
  }
  // Office and manager people with an email can sign in by link as office (viewers never).
  const office = (await db.people.toArray()).filter((p) => p.email && (p.role === 'office' || p.role === 'manager')).map((p) => ({ email: p.email!.trim().toLowerCase() }))
  if (office.length) await supabase!.from('office_user').upsert(office, { ignoreDuplicates: true })
  return n
}

/** A crew phone sends up a profile someone made on it ("I'm new here"), so the office and other phones
 * see them. Only new crew profiles; the server refuses anything else from a crew login. */
async function pushNewCrew(who: string): Promise<number> {
  const sent = await getSetting<Record<string, string>>('sent:person', {})
  const mine = (await db.people.toArray()).filter((p) => p.role === 'crew' && !(p.id in sent))
  if (!mine.length) return 0
  const { error } = await supabase!.from('person').upsert(mine.map((p) => ({ id: p.id, data: p, updated_by: who })), { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw new Error(`person: ${error.message}`)
  for (const p of mine) sent[p.id] = fingerprint(p)
  await setSetting('sent:person', sent)
  return mine.length
}

/** Removing a person on the office device also removes them on every other phone. */
export async function removePerson(id: string) {
  await db.people.delete(id)
  if (supabase && (await getSetting('officeLogin', false)) && !(await getSetting('demo', false))) {
    await supabase.from('person').delete().eq('id', id)
  }
}

/** Office: email invite, office rights and removing a login (netlify/functions/users.mts). */
export async function manageLogin(action: 'invite' | 'role' | 'remove', email: string, role?: string): Promise<string | null> {
  if (!supabase) return 'The farm account is not set up yet, so email sign-in is off. Saved on this device.'
  if (await getSetting('demo', false)) return null
  const session = await currentSession()
  if (!session || !(await getSetting('officeLogin', false))) return 'Sign in as the office first (Settings, Connections).'
  try {
    const res = await fetch('/.netlify/functions/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ action, email, role, redirectTo: location.origin + location.pathname }) })
    const out = await res.json().catch(() => ({ error: `Error ${res.status}` }))
    return res.ok && !out.error ? null : out.error ?? `Error ${res.status}`
  } catch {
    return 'No signal. Try again when the phone is online.'
  }
}

// ---- The loop ------------------------------------------------------------------------------------

export interface SyncResult { sent: number; received: number; listsSent: number; error?: string }

let running: Promise<SyncResult> | null = null
export function syncNow(): Promise<SyncResult> {
  running ??= doSync().finally(() => { running = null })
  return running
}

async function doSync(): Promise<SyncResult> {
  const r: SyncResult = { sent: 0, received: 0, listsSent: 0 }
  try {
    if (!supabase || !navigator.onLine) return r
    const session = await currentSession()
    if (!session || (await getSetting('demo', false))) return r
    const office = await getSetting('officeLogin', false)
    // Pull first, so the office never overwrites a newer list it has not seen.
    r.received += await pullMaster()
    const p = await pushEntries()
    if (p.error) r.error = p.error
    r.sent = p.sent
    const rows = await pullSince('entry', 'received_at', 'pull:entry')
    if (rows.length) await db.entries.bulkPut(rows.map(fromRow))
    r.received += rows.length
    if (office) r.listsSent = await pushMaster(session.user.email ?? 'office')
    else r.listsSent = await pushNewCrew(session.user.email ?? 'crew')
    await setSetting('lastSync', new Date().toISOString())
  } catch (e: any) {
    r.error = e?.message ?? String(e)
  }
  return r
}

export function startAutoSync() {
  if (!supabase) return
  supabase.auth.onAuthStateChange((event, session) => {
    // An email-link sign-in lands here; work out whether it is an office login, then sync.
    // The server only ever makes an email-link login the office, never the shared crew login.
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) checkOffice().then(() => syncNow())
  })
  const go = () => { syncNow().catch(() => {}) }
  window.addEventListener('online', go)
  setInterval(go, 60000)
  go()
}
