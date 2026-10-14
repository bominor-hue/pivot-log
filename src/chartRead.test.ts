import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { CHART_FIELDS, cleanReading } from './chartRead'

describe('sprinkler chart reading', () => {
  it('keeps numbers as numbers and drops blanks, junk and repeats', () => {
    const r = cleanReading({
      values: [
        { key: 'flowGpm', value: '1,050', seenAs: 'SYSTEM GPM 1050' },
        { key: 'designPsi', value: '', seenAs: '' },
        { key: 'lengthFt', value: 'n/a', seenAs: '' },
        { key: 'endGun', value: 'Nelson SR100, 0.7" nozzle', seenAs: 'END GUN SR100' },
        { key: 'flowGpm', value: '900', seenAs: 'second page' },
        { key: 'somethingElse', value: '5', seenAs: '' },
      ],
      notes: ' Pressure is cut off on page 2. ',
    })
    expect(r.values).toEqual([
      { key: 'flowGpm', value: 1050, seenAs: 'SYSTEM GPM 1050' },
      { key: 'endGun', value: 'Nelson SR100, 0.7" nozzle', seenAs: 'END GUN SR100' },
    ])
    expect(r.notes).toBe('Pressure is cut off on page 2.')
  })

  it('every chart field is a field on the pivot info sheet', async () => {
    const { PIVOT_INFO_COLUMNS } = await import('./import/pivotInfo')
    for (const f of CHART_FIELDS) expect(PIVOT_INFO_COLUMNS.find((c) => c.key === f.key)?.col).toBe(f.label)
  })

  it('the answer format the reader asks for builds', () => {
    const fmt = betaZodOutputFormat(z.object({ values: z.array(z.object({ key: z.enum(CHART_FIELDS.map((f) => f.key) as [string, ...string[]]), value: z.string(), seenAs: z.string() })), notes: z.string() }))
    expect(JSON.stringify(fmt)).toContain('flowGpm')
  })
})
