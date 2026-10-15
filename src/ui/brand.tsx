import { useEffect, useId, useRef, useState } from 'react'

// Pivot Log's mark, crop symbols and the small animated pictures (rain gauge, raindrops, sun, soil
// water tank, sprinkler, lap ring, sprout). All of them stop under Reduce Motion (src/styles.css).
// Drawn as SVG strings we write ourselves, so they render the same in every screen.

const svg = (viewBox: string, inner: string, props: Record<string, any> = {}) =>
  <svg viewBox={viewBox} aria-hidden={props['aria-label'] ? undefined : true} role={props['aria-label'] ? 'img' : undefined} {...props} dangerouslySetInnerHTML={{ __html: inner }} />
const uidOf = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '')

/* ---------- crop symbols: one 24-pt grid, one stroke weight, round ends ---------- */
type Ink = { ink: string; fill: string; soft?: string; leaf?: string; leafFill?: string }
export type CropKey = 'Cotton' | 'Peanuts' | 'Corn' | 'All'
export const cropKey = (c: string | null | undefined): CropKey => (c === 'Cotton' || c === 'Peanuts' || c === 'Corn' ? c : 'All')

function cropPaths(c: CropKey, k: Ink): string {
  const sw = 'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"'
  if (c === 'Cotton') {
    const L = [[7.4, 12.6, 3.7], [12, 8.3, 4.3], [16.6, 12.6, 3.7], [12, 15.4, 3.9]]
    return `<path d="M12 12.5 3.4 18.6c2.6-.1 4.6.4 5.9 1.5L12 23l2.7-2.9c1.3-1.1 3.3-1.6 5.9-1.5z" fill="${k.leafFill}" stroke="${k.leaf}" ${sw}/>
   <g fill="${k.ink}">${L.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 0.85}"/>`).join('')}</g>
   <g fill="${k.fill}">${L.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
   <path d="M12 11.6v3.2M12 11.6 9.6 10.2M12 11.6l2.4-1.4" fill="none" stroke="${k.soft}" stroke-width="1.3" stroke-linecap="round"/>`
  }
  if (c === 'Peanuts') return `<g transform="rotate(-40 12 12)">
   <path d="M12 2.9c2.6 0 4.1 1.9 4.1 4.3 0 1.9-1 2.9-1 4.8s1.3 2.8 1.3 4.8c0 2.6-1.9 4.3-4.4 4.3s-4.4-1.7-4.4-4.3c0-2 1.3-2.9 1.3-4.8s-1-2.9-1-4.8c0-2.4 1.5-4.3 4.1-4.3z" fill="${k.fill}" stroke="${k.ink}" ${sw}/>
   <path d="M9.6 12.1q2.4.9 4.8 0" fill="none" stroke="${k.soft}" stroke-width="1.3" stroke-linecap="round"/>
   <g fill="${k.soft}"><circle cx="10.7" cy="6.4" r=".75"/><circle cx="13.3" cy="6.4" r=".75"/><circle cx="12" cy="8.7" r=".75"/><circle cx="10.5" cy="15.3" r=".75"/><circle cx="13.5" cy="15.3" r=".75"/><circle cx="12" cy="17.7" r=".75"/></g></g>`
  if (c === 'Corn') return `<g transform="rotate(14 12 12)">
   <path d="M9 16.4c-.7-1.5-1.1-3.4-1.1-5.4 0-5 1.8-8.6 4.1-8.6s4.1 3.6 4.1 8.6c0 2-.4 3.9-1.1 5.4" fill="${k.fill}" stroke="${k.ink}" ${sw}/>
   <path d="M12 3.6v10.6M9.1 6.4h5.8M8.3 9.3h7.4M8.2 12.2h7.6" fill="none" stroke="${k.soft}" stroke-width="1.2" stroke-linecap="round"/>
   <path d="M11.6 14.6c-2.7 1-4.5 3.4-5.1 7 2.8-.3 4.9-1.8 5.8-4.4z" fill="${k.leafFill}" stroke="${k.leaf}" ${sw}/>
   <path d="M12.4 14.6c2.7 1 4.5 3.4 5.1 7-2.8-.3-4.9-1.8-5.8-4.4z" fill="${k.leafFill}" stroke="${k.leaf}" ${sw}/></g>`
  return `<circle cx="12" cy="12" r="8.6" fill="none" stroke="${k.ink}" ${sw}/><path d="M12 12V3.4a8.6 8.6 0 1 1-8.6 8.6z" fill="${k.fill}"/><path d="M12 12H5.6" fill="none" stroke="${k.ink}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.9" fill="${k.ink}"/>`
}
const INK: Record<CropKey, Ink> = {
  Cotton: { ink: 'var(--cotton-ink)', fill: 'var(--cotton-fill)', soft: 'color-mix(in srgb,var(--cotton-ink) 55%,transparent)', leaf: 'var(--husk)', leafFill: 'color-mix(in srgb,var(--husk) 22%,transparent)' },
  Peanuts: { ink: 'var(--peanut-ink)', fill: 'color-mix(in srgb,var(--peanut) 38%,transparent)', soft: 'color-mix(in srgb,var(--peanut-ink) 60%,transparent)' },
  Corn: { ink: 'var(--corn-ink)', fill: 'color-mix(in srgb,var(--corn) 45%,transparent)', soft: 'color-mix(in srgb,var(--corn-ink) 55%,transparent)', leaf: 'var(--husk)', leafFill: 'color-mix(in srgb,var(--husk) 30%,var(--card))' },
  All: { ink: 'currentColor', fill: 'color-mix(in srgb,currentColor 18%,transparent)' },
}
const BADGE: Record<CropKey, [string, string]> = { Cotton: ['#7DB9A2', '#4B8A74'], Peanuts: ['#CB9C63', '#956535'], Corn: ['#F4C649', '#D8960F'], All: ['#4BA6E0', '#0E6BA8'] }
const WHITE: Ink = { ink: '#fff', fill: 'rgba(255,255,255,.3)', soft: 'rgba(255,255,255,.75)', leaf: '#fff', leafFill: 'rgba(255,255,255,.3)' }

/** The crop symbol in its own colors (filter, tables). */
export function CropGlyph({ crop, size }: { crop: string | null | undefined; size?: number }) {
  const c = cropKey(crop)
  return svg('0 0 24 24', cropPaths(c, INK[c]), { className: 'glyph', width: size, height: size })
}

/** The crop symbol in white on a round badge, the shape of a pivot field (lists). */
export function CropTile({ crop, size = 32 }: { crop: string | null | undefined; size?: number }) {
  const c = cropKey(crop), [a, b] = BADGE[c], id = 'cb' + uidOf(useId())
  const ink = c === 'Cotton' ? { ...WHITE, fill: '#fff', soft: 'rgba(75,138,116,.55)' } : c === 'Corn' ? { ...WHITE, leafFill: b } : WHITE
  return svg('0 0 32 32', `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><circle cx="16" cy="16" r="16" fill="url(#${id})"/><g transform="translate(5 5) scale(.9167)">${cropPaths(c, ink)}</g>`,
    { className: 'tile-ic', width: size, height: size, 'aria-label': c === 'All' ? undefined : c })
}

/* ---------- the mark: a pivot from above, hub, arm, end-gun spray, watered part in green ---------- */
export function Logo({ animate = false, size = 44 }: { animate?: boolean; size?: number }) {
  const id = 'lg' + uidOf(useId())
  return svg('0 0 64 64', `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A8AC8"/><stop offset="1" stop-color="#0B5A8E"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#${id})"/>
  <circle cx="32" cy="32" r="21" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.6"/>
  <circle class="${animate ? 'lwedge' : ''}" cx="32" cy="32" r="10.5" fill="none" stroke="#7FD49A" stroke-opacity=".92" stroke-width="21" stroke-dasharray="66 66" stroke-dashoffset="16.5" transform="rotate(-90 32 32)"/>
  <g class="${animate ? 'lsweep' : ''}"><path d="M32 32 11 32" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/></g>
  <circle cx="32" cy="32" r="4.4" fill="#fff"/><g class="${animate ? 'lspray' : ''}"><circle cx="8.2" cy="28.6" r="1.4" fill="#fff" fill-opacity=".8"/><circle cx="7.4" cy="33.8" r="1.1" fill="#fff" fill-opacity=".6"/></g>`,
    { width: size, height: size, 'aria-label': 'Pivot Log' })
}

/* ---------- animated pictures ---------- */
/** Top view of a running pivot: the arm sweeps (about 14 s a turn, not real speed) and the nozzles shimmer. */
export function Sprinkler() {
  const id = 'sp' + uidOf(useId())
  return svg('0 0 100 100', `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="50" y1="8" x2="88" y2="40"><stop offset="0" stop-color="var(--rain)" stop-opacity="0"/><stop offset="1" stop-color="var(--rain)" stop-opacity=".45"/></linearGradient></defs>
  <circle cx="50" cy="50" r="44" fill="color-mix(in srgb,var(--leaf) 30%,var(--land))"/>
  <circle cx="50" cy="50" r="44" fill="none" stroke="var(--fg)" stroke-opacity=".12"/>
  <g class="arm"><path d="M50 50 50 6A44 44 0 0 1 81.1 18.9z" fill="url(#${id})"/><line x1="50" y1="50" x2="81.1" y2="18.9" stroke="var(--fg)" stroke-opacity=".75" stroke-width="2.2" stroke-linecap="round"/>
  <g class="spray" fill="var(--rain)"><circle cx="58" cy="42" r="1.8"/><circle cx="64" cy="36" r="1.8"/><circle cx="70" cy="30" r="1.8"/><circle cx="76" cy="24" r="1.8"/><circle cx="83" cy="17" r="2.6"/></g></g>
  <circle cx="50" cy="50" r="4" fill="var(--card)" stroke="var(--fg)" stroke-opacity=".6" stroke-width="1.6"/>`, { 'aria-label': 'Pivot running' })
}

/** Rain gauge with inch marks; fills once to the night's total, with three drops falling in. */
export function Gauge({ inches }: { inches: number }) {
  const top = 10, bot = 92, h = bot - top, max = 2, lvl = bot - (h * Math.min(max, inches)) / max
  let ticks = ''
  for (let v = 0; v <= max + 1e-9; v += 0.25) {
    const y = bot - (h * v) / max, major = Math.abs(v % 0.5) < 1e-9
    ticks += `<line x1="${major ? 57 : 60}" x2="64" y1="${y}" y2="${y}" stroke="var(--fg3)" stroke-width="${major ? 1.2 : 0.8}"/>` + (major ? `<text x="67" y="${y + 3}" font-size="9" fill="var(--fg3)">${v}</text>` : '')
  }
  const drop = '<path class="gdrop" d="M47 4c2 2.6 3 4.3 3 5.6a3 3 0 0 1-6 0c0-1.3 1-3 3-5.6z" fill="var(--rain)"/>'
  return svg('0 0 100 100', `${inches > 0 ? drop + drop + drop : ''}
  <rect x="36" y="${top}" width="22" height="${h}" rx="5" fill="color-mix(in srgb,var(--rain) 7%,var(--card))" stroke="var(--fg3)" stroke-opacity=".6"/>
  ${inches > 0 ? `<rect class="gfill" x="38" y="${lvl}" width="18" height="${Math.max(0, bot - lvl - 2)}" rx="3" fill="var(--rain)" fill-opacity=".85"/>` : ''}
  <rect x="40" y="${top + 4}" width="3" height="${h - 10}" rx="1.5" fill="#fff" fill-opacity=".45"/>${ticks}
  <path d="M30 ${top} h34" stroke="var(--fg3)" stroke-opacity=".6" stroke-width="1.4" stroke-linecap="round"/>`, { 'aria-label': `Rain gauge at ${inches.toFixed(2)} inches` })
}

/** A light drizzle behind a card, only when radar showed rain. */
export function Drops({ n = 8 }: { n?: number }) {
  return <div className="drops" aria-hidden="true">{Array.from({ length: n }, (_, i) =>
    <i key={i} style={{ left: `${(i * 37 + 11) % 100}%`, animationDelay: `${(i * 0.29) % 1.6}s`, animationDuration: `${1.2 + ((i * 7) % 5) / 10}s` }} />)}</div>
}

/** Sun with slow rays, a drifting cloud and heat shimmer, for crop water use. */
export function Sun() {
  let r = ''
  for (let i = 0; i < 12; i++) { const a = (i * 30 * Math.PI) / 180; r += `<line x1="${50 + 24 * Math.cos(a)}" y1="${50 + 24 * Math.sin(a)}" x2="${50 + 32 * Math.cos(a)}" y2="${50 + 32 * Math.sin(a)}"/>` }
  return svg('0 0 100 100', `<g class="rays" stroke="var(--sun)" stroke-width="4" stroke-linecap="round">${r}</g><circle cx="50" cy="50" r="17" fill="var(--sun)"/>
  <path class="shimmer" d="M30 92q5-4 10 0t10 0 10 0 10 0" stroke="var(--sun)" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <g class="cloud"><path d="M50 74h30a9 9 0 0 0 0-18 13 13 0 0 0-25-2 8 8 0 0 0-5 20z" fill="var(--card)" stroke="var(--fg3)" stroke-opacity=".35" stroke-width="1.2"/></g>`, { 'aria-label': 'Sun' })
}

/** Soil water tank: the water line ripples and moves to the new level when the filter changes. */
export function Tank({ level }: { level: number }) {
  const wave = '<svg viewBox="0 0 200 14" preserveAspectRatio="none" width="100%" height="100%"><path d="M0 7q12.5-7 25 0t25 0 25 0 25 0 25 0 25 0 25 0 25 0V14H0z" fill="var(--rain)" fill-opacity=".85"/></svg>'
  return <div className="tank" role="img" aria-label={`Soil water ${level}% full`}>
    <div className="lv" style={{ '--lv': level } as any}>
      <div className="wv b" dangerouslySetInnerHTML={{ __html: wave }} /><div className="wv" dangerouslySetInnerHTML={{ __html: wave }} /><div className="body" />
    </div>
    <div className="trig" title="Water at about 50%" />
  </div>
}

/** Lap ring: closes with a check when the pivot made it around; stops in amber when it quit short. */
export function LapRing({ frac, ok, check = true, size = 30 }: { frac: number; ok: boolean; check?: boolean; size?: number }) {
  const C = 69.1, to = (C * (1 - Math.max(0, Math.min(1, frac)))).toFixed(1)
  return svg('0 0 30 30', `<circle cx="15" cy="15" r="11" fill="none" stroke="var(--fill)" stroke-width="3.4"/><circle class="pr" cx="15" cy="15" r="11" fill="none" stroke="${ok ? 'var(--leaf)' : 'var(--amber)'}" stroke-width="3.4" stroke-linecap="round" transform="rotate(-90 15 15)" style="--to:${to}"/>${ok ? (check ? '<path class="ck" d="m10.5 15.2 3 3 6-6.2" fill="none" stroke="var(--leaf)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' : '') : '<path d="M15 10.5v5" stroke="var(--amber)" stroke-width="2.4" stroke-linecap="round"/><circle cx="15" cy="19.2" r="1.3" fill="var(--amber)"/>'}`,
    { className: 'ring', width: size, height: size, 'aria-label': ok ? 'Made it around' : 'Stopped short' })
}

/** A pivot that was started: the arm turns slowly. */
export function RunIcon({ live = true }: { live?: boolean }) {
  return svg('0 0 30 30', `<circle cx="15" cy="15" r="13" fill="color-mix(in srgb,var(--water) 14%,transparent)"/><circle cx="15" cy="15" r="8.5" fill="none" stroke="var(--water)" stroke-opacity=".4" stroke-width="1.5"/><g class="${live ? 'spin' : ''}"><path d="M15 15V6.5" stroke="var(--water)" stroke-width="2.2" stroke-linecap="round"/><circle cx="15" cy="15" r="8.5" fill="none"/></g><circle cx="15" cy="15" r="2.2" fill="var(--water)"/>`, { width: 30, height: 30, 'aria-label': live ? 'Running' : 'Started' })
}

/** The tiny turning pivot inside the Running pill. */
export function MiniPivot() {
  return svg('0 0 12 12', '<circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="1.2"/><g class="spin"><path d="M6 6 6 1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="6" cy="6" r="4.6" fill="none"/></g><circle cx="6" cy="6" r="1.4" fill="currentColor"/>', { width: 12, height: 12 })
}

/** A sprout grows when nothing needs water. */
export function Sprout() {
  return svg('0 0 100 100', '<path d="M22 90h56" stroke="var(--peanut)" stroke-width="3" stroke-linecap="round" opacity=".6"/><g class="sway"><path class="stem" d="M50 88V52" stroke="var(--leaf)" stroke-width="4" stroke-linecap="round" fill="none"/><path class="lf l" d="M50 62C38 64 28 56 26 42c13-1 22 6 24 20z" fill="var(--leaf)"/><path class="lf r" d="M50 54c3-14 13-22 27-21-1 14-12 22-27 21z" fill="color-mix(in srgb,var(--leaf) 80%,#1d4d2a)"/></g>', { className: 'sprout', 'aria-label': 'All caught up' })
}

export function DropIcon() {
  return svg('0 0 24 24', '<path d="M12 3.5c3.6 4.6 5.6 7.8 5.6 10.4a5.6 5.6 0 0 1-11.2 0c0-2.6 2-5.8 5.6-10.4z" fill="var(--rain)"/><path d="M9.4 14.6a2.8 2.8 0 0 0 2 2.6" stroke="#fff" stroke-opacity=".6" stroke-width="1.4" fill="none" stroke-linecap="round"/>')
}

export function SyncIcon() {
  return svg('0 0 24 24', '<path d="M19 12a7 7 0 0 1-12.2 4.7M5 12a7 7 0 0 1 12.2-4.7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M17.5 3.5v4h-4M6.5 20.5v-4h4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>', { width: 20, height: 20 })
}

export const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** A number that counts up from where it was to where it is now. */
export function Count({ to, dec = 0 }: { to: number; dec?: number }) {
  const [v, setV] = useState(to)
  const from = useRef(0)
  useEffect(() => {
    if (reduceMotion() || from.current === to) { setV(to); from.current = to; return }
    const a = from.current, t0 = performance.now()
    let raf = 0
    const f = (t: number) => {
      const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3)
      setV(a + (to - a) * e)
      if (k < 1) raf = requestAnimationFrame(f); else from.current = to
    }
    raf = requestAnimationFrame(f)
    return () => { cancelAnimationFrame(raf); from.current = to }
  }, [to])
  return <>{dec ? v.toFixed(dec) : Math.round(v).toLocaleString()}</>
}
