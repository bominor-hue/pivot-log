import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { db } from './db'

// Hosted database (Supabase Postgres, in the farm's own account). Optional: with no keys set the app
// runs fully on the device. With keys set, entries queue on the phone and push up when there is signal.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null

export async function waitingToSend(): Promise<number> {
  return db.entries.where('synced').equals(0).count()
}

/** Push unsent entries. Safe to call any time: entries are keyed by their id, so a retry never duplicates. */
export async function pushEntries(): Promise<{ sent: number; error?: string }> {
  if (!supabase) return { sent: 0, error: 'No hosted database set up yet; entries are kept on this device' }
  if (!navigator.onLine) return { sent: 0, error: 'Offline' }
  const { data: sess } = await supabase.auth.getSession()
  if (!sess.session) return { sent: 0, error: 'Sign in to send' }
  const pending = await db.entries.where('synced').equals(0).toArray()
  if (!pending.length) return { sent: 0 }
  const rows = pending.map((e) => ({
    id: e.id, pivot_id: e.pivotId, action: e.action, happened_at: e.happenedAt, recorded_at: e.recordedAt, who_name: e.who, how: e.how,
    lat: e.lat, lon: e.lon, direction: e.direction, percent_timer: e.percentTimer, planned_stop: e.plannedStop, start_deg: e.startDeg,
    stop_deg: e.stopDeg, end_gun: e.endGun, made_it_around: e.madeItAround, start_at: e.startAt, stop_at: e.stopAt, note: e.note, corrects_id: e.correctsId,
  }))
  const { error } = await supabase.from('entry').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
  if (error) return { sent: 0, error: error.message }
  await db.entries.bulkUpdate(pending.map((e) => ({ key: e.id, changes: { synced: 1 as const } })))
  return { sent: pending.length }
}

export function startAutoSync() {
  const go = () => { pushEntries().catch(() => {}) }
  window.addEventListener('online', go)
  setInterval(go, 60000)
  go()
}
