import { getSetting, setSetting } from './db'
import { fingerprint, supabase, currentSession } from './sync'
import type { ReminderRow } from './reminders'

// Lap reminders on a locked phone (web push). The phone turns them on once; while a pivot runs the
// app files its reminders with the farm database, and the sender (netlify/functions/reminders.mts)
// pushes them when they come due. An iPhone only allows this for the app added to the Home Screen.

const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushState = 'not-set-up' | 'unsupported' | 'add-to-home' | 'blocked' | 'off' | 'on'

const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export async function pushState(): Promise<PushState> {
  if (!vapid || !supabase) return 'not-set-up'
  if (isIos() && !standalone()) return 'add-to-home'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && (await getSetting('pushOn', false)) ? 'on' : 'off'
}

const b64urlToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))

/** Ask for permission and save this phone's push address. Returns an error message, or null. */
export async function turnOnPush(who: string): Promise<string | null> {
  if (!vapid || !supabase) return 'Reminders are not set up for the farm yet'
  if (!(await currentSession())) return 'Sign this phone in to the farm account first'
  if ((await Notification.requestPermission()) !== 'granted') return 'Notifications are blocked for Pivot Log. Allow them in the phone settings.'
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(vapid) }))
  const j = sub.toJSON()
  const { error } = await supabase.from('push_device').upsert({ endpoint: j.endpoint, keys: j.keys, who_name: who, updated_at: new Date().toISOString() })
  if (error) return error.message
  await setSetting('pushOn', true)
  return null
}

export async function turnOffPush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await supabase?.from('push_device').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
  await setSetting('pushOn', false)
}

/** File the reminders for the pivots running now. Only changes go up; safe to call often. */
export async function fileReminders(rows: ReminderRow[]) {
  if (!vapid || !supabase || !navigator.onLine || !(await currentSession()) || (await getSetting('demo', false))) return
  const sent = await getSetting<Record<string, string>>('sent:reminder', {})
  const now = Date.now()
  const changed = rows.filter((r) => Date.parse(r.fire_at) > now && sent[r.id] !== fingerprint(r))
  if (!changed.length) return
  const { error } = await supabase.from('reminder').upsert(changed)
  if (error) return
  const keep: Record<string, string> = {}
  for (const r of rows) keep[r.id] = sent[r.id] ?? ''
  for (const r of changed) keep[r.id] = fingerprint(r)
  await setSetting('sent:reminder', keep)
}

/** Office, once: make the farm's reminder keys in this browser. The private key never leaves this screen. */
export async function makeReminderKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey)
  const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return { publicKey: b64url(raw), privateKey: jwk.d! }
}
