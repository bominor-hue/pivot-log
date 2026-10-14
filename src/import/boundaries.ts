import { unzipSync, strFromU8 } from 'fflate'
import type { Geometry } from '../db'

export interface Shape { name: string; farm: string | null; geometry: Geometry; props: Record<string, any> }

const NAME_KEYS = ['field', 'name', 'field_name', 'fieldname', 'clu_name', 'label', 'title']
const FARM_KEYS = ['farm', 'farm_name', 'farmname', 'client_farm']

function propOf(props: Record<string, any>, keys: string[]): string | null {
  for (const k of Object.keys(props)) if (keys.includes(k.toLowerCase()) && props[k]) return String(props[k]).trim()
  return null
}

function fromGeoJSON(gj: any): Shape[] {
  const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : []
  return feats.filter((f: any) => f.geometry && /Polygon/.test(f.geometry.type)).map((f: any) => ({
    name: propOf(f.properties ?? {}, NAME_KEYS) ?? '', farm: propOf(f.properties ?? {}, FARM_KEYS), geometry: f.geometry, props: f.properties ?? {},
  }))
}

function fromKML(text: string): Shape[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const out: Shape[] = []
  const ring = (el: Element | null) =>
    (el?.textContent ?? '').trim().split(/\s+/).filter(Boolean).map((c) => c.split(',').slice(0, 2).map(Number))
  for (const pm of Array.from(doc.getElementsByTagName('Placemark'))) {
    const polys = Array.from(pm.getElementsByTagName('Polygon')).map((pg) => {
      const outer = ring(pg.getElementsByTagName('outerBoundaryIs')[0]?.getElementsByTagName('coordinates')[0] ?? null)
      const inner = Array.from(pg.getElementsByTagName('innerBoundaryIs')).map((ib) => ring(ib.getElementsByTagName('coordinates')[0]))
      return [outer, ...inner]
    })
    if (!polys.length) continue
    const props: Record<string, any> = {}
    for (const d of Array.from(pm.getElementsByTagName('Data'))) props[d.getAttribute('name') ?? ''] = d.textContent?.trim()
    for (const d of Array.from(pm.getElementsByTagName('SimpleData'))) props[d.getAttribute('name') ?? ''] = d.textContent?.trim()
    const name = pm.getElementsByTagName('name')[0]?.textContent?.trim() || propOf(props, NAME_KEYS) || ''
    out.push({
      name, farm: propOf(props, FARM_KEYS), props,
      geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys },
    })
  }
  return out
}

/** Read boundaries from GeoJSON, KML, KMZ or a zipped shapefile. */
export async function readBoundaries(file: File): Promise<Shape[]> {
  const n = file.name.toLowerCase()
  if (n.endsWith('.geojson') || n.endsWith('.json')) return fromGeoJSON(JSON.parse(await file.text()))
  if (n.endsWith('.kml')) return fromKML(await file.text())
  const buf = new Uint8Array(await file.arrayBuffer())
  if (n.endsWith('.kmz')) {
    const files = unzipSync(buf)
    const k = Object.keys(files).find((f) => f.toLowerCase().endsWith('.kml'))
    if (!k) throw new Error('No KML inside this KMZ')
    return fromKML(strFromU8(files[k]))
  }
  if (n.endsWith('.zip')) {
    const shp = (await import('shpjs')).default as any
    const gj = await shp(buf.buffer)
    return (Array.isArray(gj) ? gj : [gj]).flatMap(fromGeoJSON)
  }
  throw new Error('Use GeoJSON, KML, KMZ or a zipped shapefile (.zip)')
}

/** Area in acres of a lon/lat polygon (spherical approximation, good to well under 1% at field size). */
export function acresOf(g: Geometry): number {
  const R = 6378137
  const ringArea = (ring: number[][]) => {
    let a = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1]
      a += ((x2 - x1) * Math.PI / 180) * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180))
    }
    return Math.abs((a * R * R) / 2)
  }
  const poly = (p: number[][][]) => ringArea(p[0]) - p.slice(1).reduce((s, r) => s + ringArea(r), 0)
  const m2 = g.type === 'Polygon' ? poly(g.coordinates) : g.coordinates.reduce((s: number, p: number[][][]) => s + poly(p), 0)
  return m2 / 4046.8564224
}

export function centroid(g: Geometry): [number, number] {
  const ring: number[][] = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]
  const n = ring.length - 1 || 1
  let x = 0, y = 0
  for (let i = 0; i < n; i++) { x += ring[i][0]; y += ring[i][1] }
  return [x / n, y / n]
}
