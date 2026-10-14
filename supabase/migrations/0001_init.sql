-- Pivot Log database (Supabase / Postgres), in the farm's own account.
--
-- Entries (every ON, OFF, past run, correction) are the irrigation record: real columns, append-only.
-- Master lists (farms, pivots, fields, crop seasons, people, probe readings, weather, rain) mirror the
-- phone's own tables as one JSON document per row, so the phone and the server never drift apart.
-- The office's phone or computer writes them; every signed-in device reads them.
--
-- Who can do what:
--   crew      one shared crew login (email + password) set up on each crew phone by the office.
--             Reads everything, adds entries. The person's PIN on the phone says who is logging.
--   office    anyone whose email is in office_user (signs in with an email link). Also writes master lists.


-- Entries ------------------------------------------------------------------------------------------
create table entry (
  id uuid primary key,                    -- made on the phone, so an offline retry never duplicates
  pivot_id text not null,
  action text not null check (action in ('on', 'off', 'run', 'void', 'note')),
  happened_at timestamptz not null,       -- when it happened
  recorded_at timestamptz not null,       -- when it was entered on the device
  received_at timestamptz not null default now(), -- when it reached the server
  who_name text not null,
  how text not null check (how in ('app', 'office', 'agsense', 'import')),
  lat double precision, lon double precision,
  direction text check (direction in ('forward', 'reverse')),
  percent_timer numeric,
  planned_stop text check (planned_stop in ('lap', 'position', 'keep')),
  start_deg numeric, stop_deg numeric,
  end_gun boolean,
  made_it_around boolean,
  start_at timestamptz, stop_at timestamptz, -- a past run, or an AgSense week
  hours numeric,                          -- AgSense week: hours run inside start_at..stop_at
  note text,
  corrects_id uuid references entry(id),
  sent_by uuid default auth.uid()         -- the login that sent it (crew or office)
);
create index on entry (pivot_id, happened_at);
create index on entry (received_at);

create or replace function entry_is_append_only() returns trigger language plpgsql as $$
begin raise exception 'entries are never edited or deleted; add a correction entry instead'; end $$;
create trigger entry_no_update before update or delete on entry for each row execute function entry_is_append_only();

-- Master lists -------------------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := clock_timestamp(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['farm','pivot','field','crop_season','person','probe','weather_day','rain_day','import_log'] loop
    execute format('create table %I (id text primary key, data jsonb not null, updated_at timestamptz not null default clock_timestamp(), updated_by text)', t);
    execute format('create index on %I (updated_at)', t);
    execute format('create trigger %I before insert or update on %I for each row execute function touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- Written by the nightly model job (service key, which skips row security).
create table balance_daily (
  field_id text not null, date date not null,
  dap int, etc_in numeric, rain_in numeric, applied_in numeric, taw_in numeric, trigger_in numeric,
  depletion_in numeric, recommend_in numeric, status text,
  primary key (field_id, date)
);

-- Office logins ------------------------------------------------------------------------------------
create table office_user (email text primary key, added_at timestamptz not null default now());

create or replace function is_office() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from office_user where email = lower(auth.jwt() ->> 'email'))
$$;

-- The first person to sign in by email link becomes the office. Never a password (crew) login.
create or replace function claim_office() returns boolean language plpgsql security definer set search_path = public as $$
declare me text := lower(auth.jwt() ->> 'email');
begin
  if me is null then return false; end if;
  if exists (select 1 from office_user where email = me) then return true; end if;
  if exists (select 1 from office_user) then return false; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a where a ->> 'method' = 'password') then return false; end if;
  insert into office_user (email) values (me);
  return true;
end $$;
revoke all on function claim_office() from public, anon;
grant execute on function claim_office() to authenticated;

-- Row level security -------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['entry','farm','pivot','field','crop_season','person','probe','weather_day','rain_day','import_log','balance_daily','office_user'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
  end loop;
  foreach t in array array['farm','pivot','field','crop_season','person','probe','weather_day','rain_day','import_log','office_user'] loop
    execute format('create policy %I on %I for all to authenticated using (is_office()) with check (is_office())', t || '_office', t);
  end loop;
end $$;

-- Anyone signed in adds entries from the app (including past runs); imports (AgSense weeks) only from the office.
create policy entry_insert on entry for insert to authenticated
  with check (how in ('app', 'office') or is_office());
