import { describe, expect, it } from 'vitest'
import webpush from 'web-push'
import { lapReminders, runIsOver } from './reminders'
import { makeReminderKeys } from './push'

const on = { id: 'on1', happened_at: '2026-07-01T12:00:00Z' }
const e = (id: string, action: string, at: string, corrects_id: string | null = null) => ({ id, pivot_id: 'p1', action, happened_at: at, corrects_id })

describe('lap reminders', () => {
  it('files one an hour before and one at the time it should be around', () => {
    const [soon, now] = lapReminders('p1', 'Hodges 4', 'on1', '2026-07-02T03:00:00Z', () => '11:00 PM')
    expect(soon).toMatchObject({ id: 'on1:soon', fire_at: '2026-07-02T02:00:00.000Z', body: 'Hodges 4 will be around about 11:00 PM. Leave it on or turn it off?' })
    expect(now).toMatchObject({ id: 'on1:now', fire_at: '2026-07-02T03:00:00Z' })
  })

  it('drops a reminder once the run is over', () => {
    expect(runIsOver(on, [e('on1', 'on', on.happened_at)])).toBe(false)
    expect(runIsOver(on, [e('x', 'note', '2026-07-01T13:00:00Z')])).toBe(false)
    expect(runIsOver(on, [e('x', 'off', '2026-06-30T12:00:00Z')])).toBe(false) // an earlier run
    expect(runIsOver(on, [e('x', 'off', '2026-07-01T20:00:00Z')])).toBe(true)
    expect(runIsOver(on, [e('x', 'on', '2026-07-01T20:00:00Z')])).toBe(true)
    expect(runIsOver(on, [e('x', 'void', '2026-07-01T12:05:00Z', 'on1')])).toBe(true)
  })

  it('keys made in the office browser work for the sender', async () => {
    const { publicKey, privateKey } = await makeReminderKeys()
    webpush.setVapidDetails('https://pivot-log.netlify.app', publicKey, privateKey)
    // A stand-in phone: its own key pair and auth secret, as a browser would make them.
    const phone = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', phone.publicKey)).toString('base64url')
    const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url')
    const req = webpush.generateRequestDetails({ endpoint: 'https://push.example/abc', keys: { p256dh, auth } }, '{"body":"hi"}')
    expect(req.headers.Authorization).toMatch(/^vapid t=.+, k=/)
    expect((req.body as Buffer).length).toBeGreaterThan(20)
  })
})
