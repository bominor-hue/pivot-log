-- Pivot Log database (Supabase / Postgres). Mirrors the data model in the app design doc, section 6.
-- Entries are append-only: no updates or deletes; corrections are new rows that point at what they fix.
-- Runs, daily applied water and the water balance are rebuilt from entries and can always be recomputed.

create extension if not exists pgcrypto;

create table farm (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table pivot (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farm(id),
  name text not null unique,              -- System ID, e.g. "Hodges 4"
  agsense_name text,
  center_lat double precision, center_lon double precision,
  soil text, aws_0_50cm_in numeric, aws_0_100cm_in numeric,
  created_at timestamptz not null default now()
);

-- One value on a pivot's profile and where it came from (pivot info sheet, dealer chart, measured, AgSense setting).
-- History is kept: the newest best-ranked value is the one in use.
create table pivot_value (
  id bigint generated always as identity primary key,
  pivot_id uuid not null references pivot(id),
  key text not null,                      -- irrigatedAcres, flowGpm, hoursPerRev100, arcDeg, measuredGpm, epdPermit, ...
  value text not null,
  source text not null,
  source_rank int not null,               -- measured 4, dealer chart 3, pivot info sheet 2, AgSense setting 1
  recorded_at timestamptz not null default now(),
  recorded_by text
);
create index on pivot_value (pivot_id, key);

create table field (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farm(id),
  pivot_id uuid references pivot(id),     -- a pivot can water more than one field
  name text not null unique,
  fsn text, county text,
  boundary jsonb,                         -- GeoJSON geometry (lon/lat)
  boundary_acres numeric
);

create table crop_season (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references field(id),
  year int not null,
  crop text not null, acres numeric not null, plant_date date, harvest_date date,
  variety text, heat_units_to_maturity numeric,
  unique (field_id, year)
);

create table person (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,               -- Supabase auth user
  name text not null, phone text, language text default 'en',
  role text not null default 'crew' check (role in ('crew', 'manager', 'office'))
);

create table entry (
  id uuid primary key,                    -- made on the phone, so an offline retry never duplicates
  pivot_id uuid not null references pivot(id),
  action text not null check (action in ('on', 'off', 'run', 'void', 'note')),
  happened_at timestamptz not null,       -- when it happened
  recorded_at timestamptz not null,       -- when it was entered on the device
  received_at timestamptz not null default now(), -- when it reached the server
  who_name text not null,
  person_id uuid references person(id),
  how text not null,                      -- app, office, agsense, import
  lat double precision, lon double precision,
  direction text check (direction in ('forward', 'reverse')),
  percent_timer numeric,
  planned_stop text check (planned_stop in ('lap', 'position', 'keep')),
  start_deg numeric, stop_deg numeric,
  end_gun boolean,
  made_it_around boolean,
  start_at timestamptz, stop_at timestamptz, -- for a past run entered after the fact
  note text,
  photo_path text,
  corrects_id uuid references entry(id)
);
create index on entry (pivot_id, happened_at);

create or replace function entry_is_append_only() returns trigger language plpgsql as $$
begin raise exception 'entries are never edited or deleted; add a correction entry instead'; end $$;
create trigger entry_no_update before update or delete on entry for each row execute function entry_is_append_only();

create table weather_day (
  date date primary key, eto_in numeric not null, source text not null
);
create table rain_day (
  pivot_id uuid not null references pivot(id), date date not null, rain_in numeric not null, source text not null,
  primary key (pivot_id, date)
);

-- Written by the nightly model job.
create table balance_daily (
  field_id uuid not null references field(id), date date not null,
  dap int, etc_in numeric, rain_in numeric, applied_in numeric, taw_in numeric, trigger_in numeric,
  depletion_in numeric, recommend_in numeric, status text,
  primary key (field_id, date)
);

create table import_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null, file_name text not null, at timestamptz not null default now(), who text, summary text
);

create table meter_reading (
  id uuid primary key default gen_random_uuid(),
  meter_id text not null, pivot_id uuid references pivot(id), reading numeric not null, read_at timestamptz not null, photo_path text, who_name text
);
create table fault (
  id uuid primary key default gen_random_uuid(),
  pivot_id uuid references pivot(id), problem text not null, found_at timestamptz not null, reported_to text, fixed_at timestamptz, who_name text
);

-- Row level security: anyone signed in on the farm account can read everything and add entries.
-- Master lists (farms, fields, pivots) are changed by office and manager roles.
do $$ declare t text; begin
  foreach t in array array['farm','pivot','pivot_value','field','crop_season','person','entry','weather_day','rain_day','balance_daily','import_log','meter_reading','fault'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;

create or replace function is_office() returns boolean language sql stable as $$
  select exists (select 1 from person where auth_user_id = auth.uid() and role in ('office', 'manager'))
$$;

create policy entry_insert on entry for insert to authenticated with check (true);
create policy meter_insert on meter_reading for insert to authenticated with check (true);
create policy fault_insert on fault for insert to authenticated with check (true);
do $$ declare t text; begin
  foreach t in array array['farm','pivot','pivot_value','field','crop_season','person','weather_day','rain_day','balance_daily','import_log','fault'] loop
    execute format('create policy %I on %I for all to authenticated using (is_office()) with check (is_office())', t || '_office', t);
  end loop;
end $$;
