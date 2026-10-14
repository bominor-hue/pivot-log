// Sends lap reminders to locked phones. Netlify runs this every minute on the live site.
// Reads due rows from the reminder table (filed by the app, see src/push.ts), skips any whose run is
// already over, and pushes the rest to every phone in push_device.
// Netlify environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, VITE_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { LATE_LIMIT_MS, runIsOver, type ReminderRow } from '../../src/reminders'

export const config = { schedule: '* * * * *' }

export default async function sendReminders() {
  const { VITE_SUPABASE_URL: url, SUPABASE_SERVICE_KEY: key, VITE_VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv } = process.env
  if (!url || !key || !pub || !priv) return new Response('reminders not set up')
  webpush.setVapidDetails(process.env.URL || 'https://pivot-log.netlify.app', pub, priv)
  const db = createClient(url, key, { auth: { persistSession: false } })

  const now = Date.now()
  const { data: due, error } = await db.from('reminder').select('*').is('sent_at', null).lte('fire_at', new Date(now).toISOString())
  if (error) throw new Error(error.message)
  if (!due?.length) return new Response('nothing due')
  // Claim them first, so a slow run and the next minute's run never both send one.
  const { data: mine } = await db.from('reminder').update({ sent_at: new Date(now).toISOString() }).in('id', due.map((r) => r.id)).is('sent_at', null).select('*')
  const { data: devices } = await db.from('push_device').select('endpoint, keys')
  let sent = 0
  for (const r of (mine ?? []) as ReminderRow[]) {
    if (now - Date.parse(r.fire_at) > LATE_LIMIT_MS) continue
    const { data: on } = await db.from('entry').select('id, happened_at').eq('id', r.on_id).maybeSingle()
    if (on) {
      const { data: later } = await db.from('entry').select('id, pivot_id, action, happened_at, corrects_id').eq('pivot_id', r.pivot_id).gte('happened_at', on.happened_at)
      const { data: voids } = await db.from('entry').select('id, pivot_id, action, happened_at, corrects_id').eq('corrects_id', r.on_id)
      if (runIsOver(on, [...(later ?? []), ...(voids ?? [])])) continue
    }
    const msg = JSON.stringify({ title: 'Pivot Log', body: r.body, tag: r.id })
    for (const d of devices ?? []) {
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: d.keys }, msg, { TTL: 3600, urgency: 'high' })
        sent++
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await db.from('push_device').delete().eq('endpoint', d.endpoint) // phone unsubscribed
      }
    }
  }
  return new Response(`${sent} sent`)
}
