// Reads a pivot's dealer sprinkler chart from photos or a PDF and returns the pivot info values it
// shows. Nothing is saved here: the app shows the values to the office to check and save.
// Only a signed-in office login may use it (each read costs a few cents of Claude API use).
// Netlify environment variables: ANTHROPIC_API_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { CHART_FIELDS, cleanReading } from '../../src/chartRead'

const KEYS = CHART_FIELDS.map((f) => f.key) as [string, ...string[]]
const Reading = z.object({
  values: z.array(z.object({
    key: z.enum(KEYS),
    value: z.string(),
    seenAs: z.string(), // the words or numbers on the chart this came from
  })),
  notes: z.string(),
})

const PROMPT = `These pages are a center pivot's sprinkler chart (the dealer's nozzle printout or design sheet) for a farm in southwest Georgia.
Read the values below that the chart actually shows. Leave out any field the chart does not show; never estimate or calculate one.
${CHART_FIELDS.map((f) => `- ${f.key}: ${f.hint}`).join('\n')}
For numbers give the number only, in the units named (feet, gpm, psi, acres, degrees, hours). For seenAs, copy the label and value as printed.
In notes, in one or two plain sentences, say anything the office should double-check: a blurry or cut-off value, two different numbers for the same thing, or a chart that seems to be for a different machine. Leave notes empty if nothing stands out.`

type Upload = { type: string; data: string }

export default async function readChart(req: Request) {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const { ANTHROPIC_API_KEY, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anon } = process.env
  if (!ANTHROPIC_API_KEY || !url || !anon) return Response.json({ error: 'Chart reading is not set up yet (needs ANTHROPIC_API_KEY in Netlify).' }, { status: 503 })

  // Office only: check the caller's own login against the farm database.
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '')
  if (!token) return Response.json({ error: 'Sign in as the office first.' }, { status: 401 })
  const asCaller = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: office, error: authErr } = await asCaller.rpc('claim_office')
  if (authErr || office !== true) return Response.json({ error: 'Only the office login can read charts.' }, { status: 403 })

  const { files } = (await req.json()) as { files: Upload[] }
  if (!files?.length || files.length > 6) return Response.json({ error: 'Send 1 to 6 photos or one PDF.' }, { status: 400 })
  const pages: Anthropic.Beta.BetaContentBlockParam[] = files.map((f) =>
    f.type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data } }
      : { type: 'image', source: { type: 'base64', media_type: f.type as 'image/jpeg' | 'image/png' | 'image/webp', data: f.data } })

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 55_000, maxRetries: 0 }) // Netlify stops at 60 s
  try {
    const msg = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(Reading) },
      messages: [{ role: 'user', content: [...pages, { type: 'text', text: PROMPT }] }],
    })
    if (msg.stop_reason === 'refusal' || !msg.parsed_output) return Response.json({ error: 'Could not read that chart. Try a sharper photo, flat and in good light.' }, { status: 422 })
    return Response.json(cleanReading(msg.parsed_output))
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) return Response.json({ error: 'The chart took too long to read. Try fewer pages at a time.' }, { status: 504 })
    if (e instanceof Anthropic.RateLimitError) return Response.json({ error: 'Too many charts at once. Wait a minute and try again.' }, { status: 429 })
    if (e instanceof Anthropic.APIError) return Response.json({ error: `Chart reader error (${e.status}).` }, { status: 502 })
    throw e
  }
}
