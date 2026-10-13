import Dexie, { type Table } from 'dexie'
import type { Crop } from './model/waterBalance'

// Local database on the phone (IndexedDB). Everything works offline; when a hosted database is
// configured (see src/sync.ts) entries are pushed up and the server copy is the master.
// Table and column names mirror supabase/migrations/0001_init.sql.

export type Geometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: any }

export interface Farm { id: string; name: string }
export interface Field {
  id: string; farmId: string; name: string; pivotId: string | null
  fsn?: string | null; county?: string | null; boundary?: Geometry | null; boundaryAcres?: number | null
}
export interface CropSeason { id: string; fieldId: string; year: number; crop: Crop | string; acres: number; plantDate: string | null }

/** A value on the pivot profile and where it came from. Higher rank wins (see SOURCE_RANK). */
export interface Sourced<T = number | string> { value: T; source: string; at: string }
export interface Pivot {
  id: string; farmId: string; name: string; agsenseName?: string | null
  lat?: number | null; lon?: number | null
  soil?: string | null; aws50?: number | null; aws100?: number | null
  profile: Record<string, Sourced> // keyed by PROFILE_KEYS, e.g. irrigatedAcres, flowGpm, hoursPerRev100, arcDeg
}

export type Action = 'on' | 'off' | 'run' | 'void' | 'note'
export type PlannedStop = 'lap' | 'position' | 'keep'
/** Anything reported. Never edited: corrections are new entries that point at the one they fix. */
export interface Entry {
  id: string; pivotId: string; action: Action
  happenedAt: string // ISO with offset: when it happened
  recordedAt: string // when it was entered on the device
  who: string; how: 'app' | 'office' | 'agsense' | 'import'
  lat?: number | null; lon?: number | null
  direction?: 'forward' | 'reverse' | null
  percentTimer?: number | null
  plannedStop?: PlannedStop | null
  startDeg?: number | null; stopDeg?: number | null
  endGun?: boolean | null
  madeItAround?: boolean | null // on OFF
  startAt?: string | null; stopAt?: string | null // on a past run ('run')
  note?: string | null
  correctsId?: string | null // on 'void'
  synced: 0 | 1
}

export interface WeatherDay { date: string; eto: number; source: string }
export interface RainDay { pivotId: string; date: string; inches: number; source: string }
export interface ImportLog { id: string; kind: string; fileName: string; at: string; who: string; summary: string }
export interface Setting { key: string; value: any }

class PivotLogDB extends Dexie {
  farms!: Table<Farm, string>
  fields!: Table<Field, string>
  cropSeasons!: Table<CropSeason, string>
  pivots!: Table<Pivot, string>
  entries!: Table<Entry, string>
  weather!: Table<WeatherDay, string>
  rain!: Table<RainDay, [string, string]>
  imports!: Table<ImportLog, string>
  settings!: Table<Setting, string>
  constructor() {
    super('pivot-log')
    this.version(1).stores({
      farms: 'id, name',
      fields: 'id, farmId, name, pivotId',
      cropSeasons: 'id, fieldId, year',
      pivots: 'id, farmId, name, agsenseName',
      entries: 'id, pivotId, happenedAt, synced',
      weather: 'date',
      rain: '[pivotId+date], pivotId, date',
      imports: 'id, at',
      settings: 'key',
    })
  }
}

export const db = new PivotLogDB()
export const uid = () => crypto.randomUUID()

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key)
  return s ? (s.value as T) : fallback
}
export const setSetting = (key: string, value: any) => db.settings.put({ key, value })
