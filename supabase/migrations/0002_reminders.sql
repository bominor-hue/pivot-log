-- Lap reminders that reach a locked phone (web push).
--
-- A phone that turns lap reminders on saves its push address in push_device. While a pivot runs, the
-- app files two reminders for it (an hour before it should be around, and when it should be around).
-- A Netlify scheduled function (netlify/functions/reminders.mts) sends due reminders to every
-- device, unless the pivot was turned off, turned on again, or the ON was corrected first.

create table push_device (
  endpoint text primary key,          -- the phone's push address (from the browser)
  keys jsonb not null,                -- the phone's encryption keys for the message
  who_name text,                      -- who turned reminders on, for the office's reference
  sent_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table reminder (
  id text primary key,                -- '<ON entry id>:soon' or '<ON entry id>:now'
  pivot_id text not null,
  on_id uuid not null,                -- the ON entry this reminder belongs to
  fire_at timestamptz not null,
  body text not null,
  sent_at timestamptz                 -- set by the sender (also when it skips a cancelled one)
);
create index on reminder (fire_at) where sent_at is null;

alter table push_device enable row level security;
alter table reminder enable row level security;
-- Any signed-in device may add or move phones and reminders. The sender uses the service key.
create policy push_device_rw on push_device for all to authenticated using (true) with check (true);
create policy reminder_rw on reminder for all to authenticated using (true) with check (true);
