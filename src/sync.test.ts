import { describe, expect, it } from 'vitest'
import { fingerprint, fromRow, toRow } from './sync'
import type { Entry } from './db'

describe('sync', () => {
  it('an entry survives the trip to the server and back', () => {
    const e: Entry = { id: 'a', pivotId: 'p', action: 'run', happenedAt: '2026-07-10T12:00:00Z', recordedAt: '2026-07-10T12:01:00Z', who: 'Juan', how: 'agsense',
      direction: 'forward', percentTimer: 50, plannedStop: 'lap', endGun: true, madeItAround: true, startAt: '2026-07-04T00:00:00Z', stopAt: '2026-07-11T00:00:00Z', hours: 41.5, synced: 0 }
    // Postgres numeric columns come back as strings.
    const back = fromRow({ ...toRow(e), percent_timer: '50', hours: '41.5' })
    expect(back).toMatchObject({ ...e, synced: 1 })
  })
  it('fingerprint changes when a row changes', () => {
    expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1 }))
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }))
  })
})
