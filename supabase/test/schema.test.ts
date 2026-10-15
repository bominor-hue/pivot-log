import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// Runs the real migration on an in-memory Postgres with a stand-in for Supabase's auth schema,
// then checks the rules: crew reads and adds entries, only the office writes master lists.
const AUTH_STUB = `
create role anon; create role authenticated;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema public, auth to authenticated;
`
const sql = ['0001_init.sql', '0002_reminders.sql', '0003_viewers.sql'].map((f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')).join('\n')

async function setup() {
  const pg = new PGlite()
  await pg.exec(AUTH_STUB)
  await pg.exec(sql)
  await pg.exec('grant select, insert, update, delete on all tables in schema public to authenticated')
  return pg
}
const as = async (pg: PGlite, email: string, method: string) => {
  await pg.exec(`reset role; select set_config('test.jwt', '${JSON.stringify({ sub: crypto.randomUUID(), email, amr: [{ method }] })}', false); set role authenticated;`)
}
const entry = (how = 'app') => `insert into entry (id, pivot_id, action, happened_at, recorded_at, who_name, how) values ('${crypto.randomUUID()}', 'p1', 'on', now(), now(), 'Juan', '${how}')`

describe('database rules', { timeout: 30000 }, () => {
  it('first email-link sign-in claims the office; crew password login cannot', async () => {
    const pg = await setup()
    await as(pg, 'crew@farm.test', 'password')
    expect((await pg.query<{ c: boolean }>('select claim_office() c')).rows[0].c).toBe(false)
    await as(pg, 'Office@Farm.test', 'otp')
    expect((await pg.query<{ c: boolean }>('select claim_office() c')).rows[0].c).toBe(true)
    await as(pg, 'someone@else.test', 'otp')
    expect((await pg.query<{ c: boolean }>('select claim_office() c')).rows[0].c).toBe(false)
  })

  it('crew adds entries and reads lists but cannot change lists, imports or entries', async () => {
    const pg = await setup()
    await as(pg, 'office@farm.test', 'otp'); await pg.query('select claim_office()')
    await pg.exec(`insert into pivot (id, data) values ('p1', '{"name":"Hodges 4"}')`)
    await as(pg, 'crew@farm.test', 'password')
    await pg.exec(entry())
    expect((await pg.query('select * from pivot')).rows.length).toBe(1)
    await expect(pg.exec(`insert into pivot (id, data) values ('p2', '{}')`)).rejects.toThrow()
    await expect(pg.exec(entry('agsense'))).rejects.toThrow()
    await pg.exec(`update entry set note = 'x'`) // no update rule: changes nothing
    expect((await pg.query(`select * from entry where note is not null`)).rows.length).toBe(0)
    await as(pg, 'office@farm.test', 'otp')
    await pg.exec(entry('agsense'))
    await pg.exec(`delete from entry`) // no delete rule: removes nothing
    expect((await pg.query(`select * from entry`)).rows.length).toBe(2)
    await pg.exec('reset role') // and even the database owner is stopped by the append-only trigger
    await expect(pg.exec(`delete from entry`)).rejects.toThrow(/never edited or deleted/)
  })

  it('master rows stamp updated_at on every write', async () => {
    const pg = await setup()
    await pg.exec(`insert into field (id, data) values ('f1', '{}')`)
    const a = (await pg.query<{ u: string }>(`select updated_at::text u from field`)).rows[0].u
    await pg.exec(`update field set data = '{"x":1}'`)
    const b = (await pg.query<{ u: string }>(`select updated_at::text u from field`)).rows[0].u
    expect(b > a).toBe(true)
  })

  it('crew phones turn reminders on and file lap reminders', async () => {
    const pg = await setup()
    await as(pg, 'crew@farm.test', 'password')
    await pg.exec(`insert into push_device (endpoint, keys, who_name) values ('https://push.example/1', '{"p256dh":"a","auth":"b"}', 'Juan')`)
    await pg.exec(`insert into reminder (id, pivot_id, on_id, fire_at, body) values ('x:now', 'p1', '${crypto.randomUUID()}', now(), 'Hodges 4 should be around now.')`)
    await pg.exec(`update reminder set fire_at = now() + interval '1 hour'`)
    expect((await pg.query('select * from reminder')).rows.length).toBe(1)
  })

  it('viewers read everything but add no entries or reminders', async () => {
    const pg = await setup()
    await as(pg, 'office@farm.test', 'otp'); await pg.query('select claim_office()')
    await pg.exec(`insert into person (id, data) values ('v1', '{"name":"County agent","role":"viewer","email":"Agent@County.test"}')`)
    await as(pg, 'agent@county.test', 'otp')
    expect((await pg.query('select * from person')).rows.length).toBe(1)
    await expect(pg.exec(entry())).rejects.toThrow()
    await expect(pg.exec(`insert into push_device (endpoint, keys) values ('https://push.example/2', '{}')`)).rejects.toThrow()
    await as(pg, 'crew@farm.test', 'password')
    await pg.exec(entry())
    await as(pg, 'office@farm.test', 'otp')
    await pg.exec(entry())
    expect((await pg.query('select * from entry')).rows.length).toBe(2)
  })

  it('crew phones can add a new crew profile, nothing more', async () => {
    const pg = await setup()
    await as(pg, 'office@farm.test', 'otp'); await pg.query('select claim_office()')
    await as(pg, 'crew@farm.test', 'password')
    await pg.exec(`insert into person (id, data) values ('c1', '{"name":"Juan","role":"crew"}')`)
    await expect(pg.exec(`insert into person (id, data) values ('c2', '{"name":"Me","role":"office"}')`)).rejects.toThrow()
    await pg.exec(`update person set data = '{"name":"Juan","role":"office"}'`) // no update rule: changes nothing
    expect((await pg.query<{ r: string }>(`select data ->> 'role' r from person`)).rows).toEqual([{ r: 'crew' }])
  })
})
