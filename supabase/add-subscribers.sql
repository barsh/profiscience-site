-- =========================================================
-- Newsletter subscribers
-- Run this once in the Supabase SQL Editor (SQL Editor → New query).
-- Idempotent: safe to re-run. Requires public.is_editor() from schema.sql.
-- =========================================================

create table if not exists public.subscribers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  name       text,
  company    text,
  status     text not null default 'subscribed'
               check (status in ('subscribed', 'unsubscribed')),
  source     text,                       -- where the signup came from
  created_at timestamptz not null default now()
);

create index if not exists subscribers_created_idx on public.subscribers (created_at desc);

-- Normalise emails to lowercase so "A@x.com" and "a@x.com" can't both subscribe.
create or replace function public.lowercase_subscriber_email()
returns trigger language plpgsql as $$
begin
  new.email = lower(trim(new.email));
  return new;
end $$;

drop trigger if exists subscribers_lowercase_email on public.subscribers;
create trigger subscribers_lowercase_email
  before insert or update on public.subscribers
  for each row execute function public.lowercase_subscriber_email();

-- ---------------------------------------------------------
-- Row-level security
--   Public: may INSERT a signup, nothing else. The list cannot be read,
--           edited, or deleted by anonymous visitors — so it can't be scraped.
--   Editors: full read/manage for the admin.
-- ---------------------------------------------------------
alter table public.subscribers enable row level security;

drop policy if exists "anyone can subscribe" on public.subscribers;
create policy "anyone can subscribe"
  on public.subscribers for insert
  to anon, authenticated
  with check (true);

drop policy if exists "editors read subscribers" on public.subscribers;
create policy "editors read subscribers"
  on public.subscribers for select
  to authenticated
  using (public.is_editor());

drop policy if exists "editors update subscribers" on public.subscribers;
create policy "editors update subscribers"
  on public.subscribers for update
  to authenticated
  using (public.is_editor()) with check (public.is_editor());

drop policy if exists "editors delete subscribers" on public.subscribers;
create policy "editors delete subscribers"
  on public.subscribers for delete
  to authenticated
  using (public.is_editor());
