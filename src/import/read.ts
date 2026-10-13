import Papa from 'papaparse'
import { readSheet } from 'read-excel-file/browser'

export type Row = Record<string, any>

/** Normalize a header or name for matching: lower case, no punctuation, single spaces. */
export const norm = (s: any) => String(s ?? '').toLowerCase().replace(/[#_\-./()]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Read a CSV or Excel file into rows of { header: value }. headerMatch finds the header row in an Excel sheet. */
export async function readTable(file: File, opts: { sheet?: string; headerMatch?: (cells: string[]) => boolean } = {}): Promise<Row[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = await file.text()
    return Papa.parse<Row>(text, { header: true, skipEmptyLines: true, dynamicTyping: false }).data
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    const grid = (await (readSheet as any)(file, opts.sheet ?? 1)) as any[][]
    const match = opts.headerMatch ?? ((cells: string[]) => cells.filter(Boolean).length >= 2)
    const h = grid.findIndex((r) => match(r.map((c) => (c == null ? '' : String(c)))))
    if (h < 0) return []
    const headers = grid[h].map((c) => (c == null ? '' : String(c).trim()))
    return grid.slice(h + 1).map((r) => Object.fromEntries(headers.map((k, i) => [k, r[i] instanceof Date ? r[i].toISOString().slice(0, 10) : r[i]])))
      .filter((r) => Object.values(r).some((v) => v !== null && v !== undefined && v !== ''))
  }
  throw new Error('Use a CSV or Excel (.xlsx) file')
}

/** Find a value by any of several header names. */
export function pick(row: Row, ...names: string[]): any {
  const keys = Object.keys(row)
  for (const n of names) {
    const k = keys.find((k) => norm(k) === norm(n))
    if (k !== undefined && row[k] !== null && row[k] !== undefined && String(row[k]).trim() !== '') return row[k]
  }
  return null
}

export function toNum(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export function toDate(v: any): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10) // Excel serial
  const s = String(v).trim()
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}
