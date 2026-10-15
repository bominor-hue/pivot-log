-- Viewers: read-only people (county agent, NRCS, a landlord). They sign in by email like the office
-- and see everything, but cannot add entries. A viewer is a person in the people list with role
-- 'viewer' and their email; the office's device sends that list up.

create or replace function is_viewer() returns boolean language sql stable security definer set search_path = public as $$
  select not is_office() and exists (
    select 1 from person
    where data ->> 'role' = 'viewer' and lower(data ->> 'email') = lower(auth.jwt() ->> 'email')
  )
$$;

drop policy entry_insert on entry;
create policy entry_insert on entry for insert to authenticated
  with check ((how in ('app', 'office') or is_office()) and not is_viewer());

-- Viewers don't file lap reminders or get them on their phones.
drop policy push_device_rw on push_device;
drop policy reminder_rw on reminder;
create policy push_device_rw on push_device for all to authenticated using (not is_viewer()) with check (not is_viewer());
create policy reminder_rw on reminder for all to authenticated using (not is_viewer()) with check (not is_viewer());
