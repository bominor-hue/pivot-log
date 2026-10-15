-- Clients: whose farms, fields and pivots these are. Each farm's data says which client it belongs to
-- (farms from before this have none and belong to the client with id 'default'). Same shape and rules
-- as the other master lists: everyone signed in reads, only the office writes.
create table client (id text primary key, data jsonb not null, updated_at timestamptz not null default clock_timestamp(), updated_by text);
create index on client (updated_at);
create trigger client_touch before insert or update on client for each row execute function touch_updated_at();
alter table client enable row level security;
create policy client_read on client for select to authenticated using (true);
create policy client_office on client for all to authenticated using (is_office()) with check (is_office());
