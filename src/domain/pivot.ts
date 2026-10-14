import type { Pivot, Sourced } from '../db'

// Pivot profile values and the source ranking from the design doc: a measured value beats the
// dealer chart, which beats a number typed into AgSense.
export const SOURCE_RANK: Record<string, number> = {
  measured: 4, 'dealer chart': 3, 'pivot info sheet': 2, register: 2, 'AgSense setting': 1, estimate: 0,
}
export const rank = (s?: string) => (s ? SOURCE_RANK[s] ?? 1 : -1)

/** Put a value on the profile unless a better-ranked one is already there. Blank never erases. */
export function setProfile(p: Pivot, key: string, value: any, source: string, at: string): boolean {
  if (value === null || value === undefined || value === '') return false
  const cur = p.profile[key]
  if (cur && rank(cur.source) > rank(source)) return false
  if (cur && cur.value === value && cur.source === source) return false
  p.profile[key] = { value, source, at } as Sourced
  return true
}

export const num = (p: Pivot, key: string): number | null => {
  const v = p.profile[key]?.value
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Flow used for inches: measured flow if we have it, else design flow, else the AgSense typed-in gpm. */
export function flow(p: Pivot): { gpm: number; source: string } | null {
  for (const k of ['measuredGpm', 'flowGpm', 'agsenseGpm']) {
    const g = num(p, k)
    if (g) return { gpm: g, source: k === 'measuredGpm' ? 'measured' : p.profile[k].source }
  }
  return null
}

/** inches = gpm x hours / (452.6 x acres) */
export const inchesFrom = (gpm: number, hours: number, acres: number) => (gpm * hours) / (452.6 * acres)

/** Hours for one pass at a percent timer. Part circles take the share of 360 they cover. */
export function hoursPerPass(p: Pivot, pct: number, learned: number | null = null): number | null {
  const h = num(p, 'hoursPerRev100') ?? learned
  if (!h || !pct) return null
  const arc = num(p, 'arcDeg') ?? 360
  return (h * 100) / pct * (arc / 360)
}
