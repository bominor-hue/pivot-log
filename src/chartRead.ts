// Reading a dealer sprinkler chart (nozzle printout) from a photo or PDF. Shared by the app (review
// screen, src/ui/ChartRead.tsx) and the reader (netlify/functions/read-chart.mts), so both agree on
// which pivot info fields a chart can fill. Values save with source 'dealer chart' and only after the
// office checks them.

/** Pivot profile keys a sprinkler chart usually shows, with the label used on the pivot info sheet. */
export const CHART_FIELDS: { key: string; label: string; numeric?: boolean; hint: string }[] = [
  { key: 'make', label: 'Pivot make', hint: 'Manufacturer, e.g. Valley, Zimmatic (Lindsay), Reinke, T-L' },
  { key: 'model', label: 'Model', hint: 'Machine model or series' },
  { key: 'serial', label: 'Pivot serial / order #', hint: 'Serial, order or quote number of the machine' },
  { key: 'dealer', label: 'Dealer', hint: 'Dealer or designer named on the chart' },
  { key: 'flowGpm', label: 'Design flow (gpm)', numeric: true, hint: 'System design flow in gallons per minute, including the end gun if the chart totals it' },
  { key: 'designPsi', label: 'Design pressure (psi)', numeric: true, hint: 'Pressure required at the pivot point (not at the end or at the regulators)' },
  { key: 'lengthFt', label: 'Length to last tower (ft)', numeric: true, hint: 'Machine length to the last tower or end of the overhang, in feet' },
  { key: 'wettedRadiusFt', label: 'Wetted radius incl. end gun (ft)', numeric: true, hint: 'Total wetted or irrigated radius including the end gun throw, in feet' },
  { key: 'towers', label: 'Towers (#)', numeric: true, hint: 'Number of towers or spans' },
  { key: 'irrigatedAcres', label: 'Irrigated acres (design or FSA)', numeric: true, hint: 'Irrigated acres the chart was designed for' },
  { key: 'arcDeg', label: 'Full or part circle (deg)', numeric: true, hint: 'Degrees of circle the design covers; 360 for a full circle' },
  { key: 'hoursPerRev100', label: 'Hours per rev at 100%', numeric: true, hint: 'Hours for one full revolution at 100% timer, only if printed' },
  { key: 'endGun', label: 'End gun (Y/N, model)', hint: 'End gun make and model with its nozzle, or "No" if the chart shows none' },
  { key: 'sprinklerPackage', label: 'Sprinkler package', hint: 'Sprinkler brand and model, regulator psi, spacing and drop height, in a short line' },
]

export interface ChartValue { key: string; value: string | number; seenAs: string }
export interface ChartReading { values: ChartValue[]; notes: string }

/** Turn the reader's raw answer into clean values: numbers as numbers, blanks dropped, unknown keys ignored. */
export function cleanReading(raw: { values?: { key?: string; value?: string | null; seenAs?: string | null }[]; notes?: string | null }): ChartReading {
  const values: ChartValue[] = []
  for (const v of raw.values ?? []) {
    const f = CHART_FIELDS.find((x) => x.key === v.key)
    const text = String(v.value ?? '').trim()
    if (!f || !text || values.some((x) => x.key === f.key)) continue
    if (f.numeric) {
      const n = parseFloat(text.replace(/,/g, ''))
      if (!Number.isFinite(n) || n <= 0) continue
      values.push({ key: f.key, value: n, seenAs: v.seenAs ?? '' })
    } else values.push({ key: f.key, value: text, seenAs: v.seenAs ?? '' })
  }
  return { values, notes: (raw.notes ?? '').trim() }
}
