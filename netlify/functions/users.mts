// People with an email sign-in (office and viewers): send the invite, change office rights, and take
// a login away. Crew sign in with a PIN on a farm phone and never need this.
// Only a signed-in office login may use it. It needs the Supabase secret key because creating and
// deleting logins is an admin job.
// Netlify environment variables: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY.
import { createClient } from '@supabase/supabase-js'

type Body = { action: 'invite' | 'role' | 'remove'; email: string; role?: 'crew' | 'manager' | 'office' | 'viewer'; redirectTo?: string }
const OFFICE_ROLES = ['office', 'manager']

export default async function users(req: Request) {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_KEY: service } = process.env
  if (!url || !anon || !service) return Response.json({ error: 'Email invites are not set up yet (needs SUPABASE_SERVICE_KEY in Netlify).' }, { status: 503 })

  const token = req.headers.get('authorization')?.replace(/^Bearer /, '')
  if (!token) return Response.json({ error: 'Sign in as the office first.' }, { status: 401 })
  const asCaller = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: office, error: authErr } = await asCaller.rpc('claim_office')
  if (authErr || office !== true) return Response.json({ error: 'Only the office can manage people.' }, { status: 403 })
  const me = (await asCaller.auth.getUser(token)).data.user?.email?.toLowerCase()

  const body = (await req.json().catch(() => ({}))) as Body
  const email = String(body.email ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: 'That email does not look right.' }, { status: 400 })
  if (email === me && body.action !== 'invite') return Response.json({ error: "You can't change your own access. Ask another office person." }, { status: 400 })

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const setOffice = async (on: boolean) => {
    const { error } = on ? await admin.from('office_user').upsert({ email }, { ignoreDuplicates: true }) : await admin.from('office_user').delete().eq('email', email)
    if (error) throw new Error(error.message)
  }

  try {
    if (body.action === 'invite') {
      await setOffice(OFFICE_ROLES.includes(body.role ?? ''))
      const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: body.redirectTo })
      // Someone who already has a login just signs in with an email code as usual.
      if (error && !/already|registered|exists/i.test(error.message)) return Response.json({ error: error.message }, { status: 502 })
      return Response.json({ ok: true, existing: !!error })
    }
    if (body.action === 'role') {
      await setOffice(OFFICE_ROLES.includes(body.role ?? ''))
      return Response.json({ ok: true })
    }
    if (body.action === 'remove') {
      await setOffice(false)
      // A farm has a handful of logins, so one page finds them.
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (error) return Response.json({ error: error.message }, { status: 502 })
      const user = data.users.find((u) => u.email?.toLowerCase() === email)
      if (user) {
        const { error: delErr } = await admin.auth.admin.deleteUser(user.id)
        if (delErr) return Response.json({ error: delErr.message }, { status: 502 })
      }
      return Response.json({ ok: true, found: !!user })
    }
    return Response.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 502 })
  }
}
