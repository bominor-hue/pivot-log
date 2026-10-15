// Lap reminders, shared by the app (which files them) and the sender (netlify/functions/reminders.mts).
// Nothing here touches the browser or the database, so both sides and the tests use the same rules.

export interface ReminderRow { id: string; pivot_id: string; on_id: string; fire_at: string; body: string }

/** The two reminders for a running pivot: an hour before it should be around, and when it should be. */
export function lapReminders(pivotId: string, pivotName: string, onId: string, eta: string, clock: (iso: string) => string): ReminderRow[] {
  const soon = new Date(Date.parse(eta) - 3600000).toISOString()
  return [
    { id: `${onId}:soon`, pivot_id: pivotId, on_id: onId, fire_at: soon, body: `${pivotName} will be around about ${clock(eta)}. Leave it on or turn it off?` },
    { id: `${onId}:now`, pivot_id: pivotId, on_id: onId, fire_at: eta, body: `${pivotName} should be around now. Did it make it?` },
  ]
}

/** How late a reminder may still go out. Older ones are dropped (the phone was off, or the sender was down). */
export const LATE_LIMIT_MS = 3 * 3600000

interface EntryLite { id: string; pivot_id: string; action: string; happened_at: string; corrects_id: string | null }

/**
 * A reminder is stale once its run is over: the pivot was turned off or turned on again after this ON,
 * a past run was logged over it, or the ON itself was corrected away.
 */
export function runIsOver(on: Pick<EntryLite, 'id' | 'happened_at'>, later: EntryLite[]): boolean {
  const t = Date.parse(on.happened_at)
  return later.some((e) =>
    e.id !== on.id && ((e.action === 'void' && e.corrects_id === on.id) || (['on', 'off', 'run'].includes(e.action) && Date.parse(e.happened_at) >= t)))
}
